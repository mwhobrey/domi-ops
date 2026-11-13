import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createBetterAuth, MCP_POLICY_VERSION } from "@domi-ops/auth";
import { envSchema, type Env } from "@domi-ops/config";
import {
  createDb, closeDb, householdMembers, households, users, householdSubscriptions, oauthClient, userNotifications, pushSubscriptions,
  healthMedications, healthMedicationGroups, healthMedicationGroupMembers, healthMedicationLogs,
  mcpActionEvents, mcpConnectionCapabilities, mcpMedGroupMemberConsents, mcpMedGroupSelections,
  withSystemContext, withUserLookupContext, withHouseholdContext, withMcpProviderContext, type Database,
} from "@domi-ops/db";
import { mcpAuthorizationRoutes } from "./mcp-authorization.js";
import { mcpGateway } from "../mcp/gateway.js";
import { encryptHealthField } from "../lib/health-crypto.js";
import { recordDose } from "../lib/health-med-logging.js";

// Push delivery is the only part replaced; with no stub set it behaves as shipped.
const push = vi.hoisted(() => ({ deliver: vi.fn() }));
vi.mock("@domi-ops/calendar-sync", async (original) => {
  const actual = await original<typeof import("@domi-ops/calendar-sync")>();
  push.deliver.mockImplementation(actual.deliverUserNotificationToSubscriptions);
  return { ...actual, deliverUserNotificationToSubscriptions: push.deliver };
});

const url = process.env.MCP_TEST_DATABASE_URL ?? process.env.HOSTED_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
type Person = { userId: string; memberId: string; householdId: string; headers: Headers };
type Choice = { groupId: string; canLog: boolean; shareCounts?: boolean; alias?: string | null; excludedMedicationIds?: string[] };
type Occurrence = { occurrenceRef: string; localTime: string; status: string; total?: number; notAccessibleToAssistant?: number };
type Schedule = { date: string; data: { label: string; canLog: boolean; occurrences: Occurrence[] }[] };
const scopes = ["shopping:read", "health:read", "health:write", "offline_access"];
const READ = "health.groups.read", LOG = "health.groups.log";
// Every medication and group name carries this marker so one assertion proves none of them leaked.
const SECRET = "Fictional-secret-med";

for (const mode of ["single", "shared"] as const) suite(`MCP medication groups (${mode}, restricted role)`, () => {
  let db: Database, auth: ReturnType<typeof createBetterAuth>, env: Env, server: ReturnType<typeof serve>, origin: string, clientId: string;
  let owner: Person, peer: Person, stranger: Person;
  let morning: string, night: string, peerGroup: string, cookiePrefix: string;
  const meds: Record<string, string> = {};
  const householdIds: string[] = [], userIds: string[] = [], clientIds: string[] = [];
  const callback = "https://synthetic-assistant.example.test/med-groups", verifier = "m".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const gateway = (overrides: Partial<Env> = {}) => mcpGateway(db, auth.mcp, { ...env, ...overrides });

  async function owned<T>(person: Person, fn: (tx: Database) => Promise<T>) {
    return withUserLookupContext(db, person.userId, (lookup) => withHouseholdContext(lookup, person.householdId, fn));
  }
  async function post(path: string, body: unknown, person = owner) {
    return fetch(origin + path, { method: "POST", headers: person.headers, body: JSON.stringify(body) });
  }
  /** Consent goes through the HTTP route so the group selection is written in the grant's own transaction. */
  async function prepare(capabilities: string[] | undefined, medGroups?: Choice[], extra: Record<string, unknown> = { healthAcknowledged: true }, person = owner) {
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback, scope: scopes.join(" "), resource: origin + "/api/mcp", state: randomUUID(), code_challenge: challenge, code_challenge_method: "S256" });
    const start = await fetch(origin + "/auth/oauth2/authorize?" + query, { headers: person.headers, redirect: "manual" });
    const location = start.headers.get("location") ?? (await start.json() as { url: string }).url;
    const oauthQuery = new URL(location, origin).searchParams.toString();
    const response = await post("/api/mcp-auth/consents/prepare", { householdId: person.householdId, oauthQuery, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true,
      policyVersion: MCP_POLICY_VERSION, ...(capabilities ? { capabilities } : {}), ...(medGroups ? { medGroups, ...extra } : {}) }, person);
    return { response, oauthQuery };
  }
  async function connect(capabilities: string[] | undefined, medGroups?: Choice[], person = owner) {
    const { response, oauthQuery } = await prepare(capabilities, medGroups, { healthAcknowledged: true }, person);
    expect(response.status, await response.clone().text()).toBe(200);
    const pending = await response.json() as { pendingId: string; capabilities: string[] };
    const decided = await auth.mcp.decideConsent(person.headers, { pendingId: pending.pendingId, oauthQuery, accept: true });
    if (!decided.accepted) throw new Error("fictional consent denied");
    const code = new URL(decided.redirectUri).searchParams.get("code")!;
    const token = await fetch(origin + "/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, code, code_verifier: verifier, resource: origin + "/api/mcp" }) });
    expect(token.status).toBe(200);
    return { ...await token.json() as { access_token: string }, connectionId: decided.connectionId, capabilities: pending.capabilities };
  }
  let sequence = 0;
  async function rpc(token: string, method: string, params?: Record<string, unknown>, target = gateway()) {
    const response = await target.request(origin + "/api/mcp", { method: "POST",
      headers: { host: new URL(origin).host, authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, ...(params ? { params } : {}) }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const text = await response.text();
    return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : text) as {
      error?: unknown; result: { tools?: { name: string; annotations?: Record<string, unknown> }[]; isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text: string }[] } };
  }
  const names = async (token: string, target = gateway()) => (await rpc(token, "tools/list", undefined, target)).result.tools!.map((tool) => tool.name);
  async function schedule(token: string, day = "today", target = gateway()) {
    const response = await rpc(token, "tools/call", { name: "get_medication_group_schedule", arguments: { day } }, target);
    expect(response.result?.isError, JSON.stringify(response)).not.toBe(true);
    return { raw: JSON.stringify(response), value: response.result.structuredContent as unknown as Schedule };
  }
  async function log(token: string, occurrenceRef: string, target = gateway()) {
    const response = await rpc(token, "tools/call", { name: "log_medication_group", arguments: { occurrenceRef } }, target);
    return { raw: JSON.stringify(response), refused: response.error !== undefined || response.result?.isError === true, value: response.result?.structuredContent as Record<string, unknown> | undefined };
  }
  const group = (value: Schedule, label: string) => value.data.find((entry) => entry.label === label)!;
  const doseLogs = (ids: string[]) => owned(owner, (tx) => tx.select().from(healthMedicationLogs).where(inArray(healthMedicationLogs.medicationId, ids)));
  const clearLogs = () => owned(owner, (tx) => tx.delete(healthMedicationLogs).where(inArray(healthMedicationLogs.medicationId, Object.values(meds))));
  async function medication(person: Person, name: string, times: string[], enabled = true) {
    const [row] = await owned(person, (tx) => tx.insert(healthMedications).values({ householdId: person.householdId, memberId: person.memberId, name: encryptHealthField(`${SECRET} ${name}`, env)!,
      dosage: encryptHealthField(`${SECRET} 10 mg`, env), instructions: encryptHealthField(`${SECRET} with food`, env), scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times }), enabled }).returning({ id: healthMedications.id }));
    return row.id;
  }
  async function medGroup(person: Person, name: string, times: string[], members: string[]) {
    const [row] = await owned(person, (tx) => tx.insert(healthMedicationGroups).values({ householdId: person.householdId, memberId: person.memberId, name: encryptHealthField(name, env)!, scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times }) }).returning({ id: healthMedicationGroups.id }));
    if (members.length) await owned(person, (tx) => tx.insert(healthMedicationGroupMembers).values(members.map((medicationId) => ({ groupId: row.id, medicationId }))));
    return row.id;
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const app = new Hono();
    const tls = process.env.MCP_TEST_TLS_KEY_FILE ? { createServer, serverOptions: { key: readFileSync(process.env.MCP_TEST_TLS_KEY_FILE), cert: readFileSync(process.env.MCP_TEST_TLS_CERT_FILE!) } } : {};
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0, ...tls });
    await new Promise<void>((resolve) => server.listening ? resolve() : server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw Error("loopback required");
    origin = (process.env.MCP_TEST_TLS_KEY_FILE ? "https:" : "http:") + "//127.0.0.1:" + address.port;
    env = envSchema.parse({ NODE_ENV: "test", DEPLOYMENT_MODE: mode, PUBLIC_APP_URL: origin, API_URL: origin, DATABASE_URL: url,
      // Shared with the other MCP suites: they run against one database and one signing key.
      SESSION_SECRET: "synthetic-who469-session-secret-for-disposable-fixtures-only", ENCRYPTION_KEY: "synthetic-med-group-encryption-only",
      MCP_ENABLED: "true", MCP_SYNTHETIC_DEPLOYMENT: "true", MCP_READ_SCOPES: "shopping:read,health:read",
      MCP_DIRECT_ACTIONS_ENABLED: "true", MCP_DIRECT_ACTIONS: "health.groups.log", MODULES_ENABLED: "core,health" });
    cookiePrefix = "meds" + randomUUID().replaceAll("-", "");
    auth = createBetterAuth(db, env, { cookiePrefix, deferHouseholdMembership: async () => true });
    app.all("/auth/*", (c) => auth.handler(c.req.raw));
    app.route("/api/mcp-auth", mcpAuthorizationRoutes(auth.mcp, env));
    for (let i = 0; i < 2; i++) {
      const [household] = await withSystemContext(db, (tx) => tx.insert(households).values({ name: "Fictional medication household", modulesEnabled: '["core","health"]' }).returning());
      householdIds.push(household.id);
    }
    const signup = async (householdId: string, role: "owner" | "member"): Promise<Person> => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let response: Response;
      try { response = await fetch(origin + "/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Fictional Medication Member", email: randomUUID() + "@example.test", password: "Synthetic-only-medication-fixture-2026" }) }); }
      finally { warn.mockRestore(); }
      expect(response.status).toBe(200);
      const { user } = await response.json() as { user: { id: string } }; userIds.push(user.id);
      const [member] = await withSystemContext(db, (tx) => tx.insert(householdMembers).values({ householdId, userId: user.id, role }).returning());
      return { userId: user.id, memberId: member.id, householdId, headers: new Headers({ origin, "content-type": "application/json", cookie: response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") }) };
    };
    owner = await signup(householdIds[0], "owner"); peer = await signup(householdIds[0], "member"); stranger = await signup(householdIds[1], "owner");
    for (const person of [owner, stranger]) {
      await auth.mcp.setHouseholdEnabled(person.headers, person.householdId, true);
      await owned(person, (tx) => tx.insert(householdSubscriptions).values({ householdId: person.householdId, modulesEntitled: '["core","health"]', status: "active" }));
    }
    const client = await auth.mcp.registerClient(owner.headers, { name: "Fictional medication client", redirectUris: [callback], tokenEndpointAuthMethod: "none", scopes, provider: "local", profileVersion: "med-groups.fixture.v1", dataMode: "synthetic", enabled: true });
    clientId = client.client_id; clientIds.push(clientId);
    // Morning has four due medications and one paused. D is taken twice a day and also belongs to Night.
    meds.a = await medication(owner, "A", ["08:00"]); meds.b = await medication(owner, "B", ["08:00"]); meds.c = await medication(owner, "C", ["08:00"]);
    meds.d = await medication(owner, "D", ["08:00", "20:00"]); meds.paused = await medication(owner, "Paused", ["08:00"], false);
    // In the group by membership, but its own schedule has no 08:00 dose.
    meds.elsewhere = await medication(owner, "Elsewhere", ["13:00"]);
    morning = await medGroup(owner, `${SECRET} Morning`, ["08:00"], [meds.a, meds.b, meds.c, meds.d, meds.paused, meds.elsewhere]);
    night = await medGroup(owner, `${SECRET} Night`, ["20:00"], [meds.d]);
    peerGroup = await medGroup(peer, `${SECRET} Peer`, ["09:00"], [await medication(peer, "PeerMed", ["09:00"])]);
  }, 30000);
  afterAll(async () => {
    if (db) {
      await withSystemContext(db, async (tx) => {
        if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds));
        if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      });
      await withMcpProviderContext(db, async (tx) => { if (clientIds.length) await tx.delete(oauthClient).where(inArray(oauthClient.clientId, clientIds)); });
      await closeDb(db);
    }
    await new Promise<void>((resolve, reject) => server ? server.close((error) => error ? reject(error) : resolve()) : resolve());
  });

  it("never makes medication access a default and validates group choices at consent", async () => {
    const plain = await connect(undefined);
    expect(plain.capabilities).toEqual(["shopping.read"]);
    expect(await names(plain.access_token)).toEqual(["get_connection_context", "list_shopping_items"]);
    const refused = async (capabilities: string[] | undefined, groups: Choice[], extra?: Record<string, unknown>) => expect((await prepare(capabilities, groups, extra)).response.status).toBe(400);
    await refused([READ], [{ groupId: morning, canLog: false }], {});                                  // no health acknowledgment
    await refused(["shopping.read"], [{ groupId: morning, canLog: false }]);                           // capability not chosen
    await refused([READ], [{ groupId: morning, canLog: true }]);                                       // logging without its capability
    await refused([LOG], []);                                                                          // logging without reading
    await refused([READ], [{ groupId: peerGroup, canLog: false }]);                                    // another member's group
    await refused([READ], [{ groupId: morning, canLog: false, excludedMedicationIds: [meds.elsewhere, randomUUID()] }]); // not a member medication
    await refused([READ], [{ groupId: morning, canLog: false }, { groupId: morning, canLog: false }]); // duplicate
    // The member's own picker shows names; nobody else's groups appear in it.
    const picker = await (await post("/api/mcp-auth/health-groups", { householdId: owner.householdId })).json() as { groups: { id: string; name: string; medications: { name: string }[] }[] };
    expect(picker.groups.map((entry) => entry.id).sort()).toEqual([morning, night].sort());
    expect(JSON.stringify(picker)).toContain(`${SECRET} A`);
    expect(JSON.stringify(picker)).not.toContain("Peer");
    expect((await post("/api/mcp-auth/health-groups", { householdId: stranger.householdId })).status).toBe(403);
  });

  it("shares a label, times and status and nothing that names a medication", async () => {
    await clearLogs();
    const token = await connect(["shopping.read", READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning", excludedMedicationIds: [meds.c] }, { groupId: night, canLog: false, alias: "Evening set" }]);
    const listed = (await rpc(token.access_token, "tools/list")).result.tools!;
    expect(listed.map((tool) => tool.name)).toEqual(["get_connection_context", "list_shopping_items", "get_medication_group_schedule", "log_medication_group"]);
    expect(listed.find((tool) => tool.name === "log_medication_group")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const { raw, value } = await schedule(token.access_token);
    expect(value.data.map((entry) => entry.label)).toEqual(["Morning", "Evening set"]);
    // Four are due at 08:00. Paused and not-scheduled-then members are not counted; C is excluded for this assistant.
    expect(group(value, "Morning")).toMatchObject({ canLog: true, occurrences: [{ localTime: "08:00", status: "pending", total: 4, notAccessibleToAssistant: 1 }] });
    expect(group(value, "Evening set")).toMatchObject({ canLog: false, occurrences: [{ localTime: "20:00", status: "pending", total: 1, notAccessibleToAssistant: 0 }] });
    expect(Object.keys(value.data[0]).sort()).toEqual(["canLog", "label", "occurrences"]);
    expect(Object.keys(value.data[0].occurrences[0]).sort()).toEqual(["localTime", "notAccessibleToAssistant", "occurrenceRef", "status", "total"]);
    // No name, strength, instruction, medication id or group id, including inside the signed reference.
    const decoded = raw + Buffer.from(value.data[0].occurrences[0].occurrenceRef.split(".")[0], "base64url").toString("utf8");
    expect(decoded).not.toContain(SECRET);
    for (const id of Object.values(meds)) expect(decoded).not.toContain(id);
    for (const day of ["yesterday", "tomorrow"]) expect((await schedule(token.access_token, day)).value.data).toHaveLength(2);
  });

  it("logs the approved doses, says how many it could not, and is safe to repeat", async () => {
    await clearLogs();
    const token = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning", excludedMedicationIds: [meds.c] }]);
    const [occurrence] = group((await schedule(token.access_token)).value, "Morning").occurrences;
    const first = await log(token.access_token, occurrence.occurrenceRef);
    expect(first.value).toMatchObject({ outcome: "logged", label: "Morning", localTime: "08:00", logged: 3, alreadyRecorded: 0, notAccessible: 1 });
    const rows = await doseLogs(Object.values(meds));
    expect(rows.map((row) => row.medicationId).sort()).toEqual([meds.a, meds.b, meds.d].sort());
    expect(rows.every((row) => row.status === "taken" && row.loggedByUserId === owner.userId && row.loggedViaConnectionId === token.connectionId)).toBe(true);
    expect(new Set(rows.map((row) => row.scheduledAt!.getTime())).size).toBe(1);
    const again = await log(token.access_token, occurrence.occurrenceRef);
    expect(again.value).toMatchObject({ outcome: "nothing_to_log", logged: 0, alreadyRecorded: 3, notAccessible: 1 });
    expect(await doseLogs(Object.values(meds))).toHaveLength(3);
    expect(group((await schedule(token.access_token)).value, "Morning").occurrences[0]).toMatchObject({ status: "partly_taken" });
    // The member is told in the app, and neither that notice nor the activity record holds health content.
    const notices = await owned(owner, (tx) => tx.select().from(userNotifications).where(and(eq(userNotifications.userId, owner.userId), sql`${userNotifications.tag} like ${"mcp-med:" + token.connectionId + "%"}`)));
    expect(notices).toHaveLength(1);
    const events = await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)));
    expect(events.map((event) => event.outcome).sort()).toEqual(["logged", "nothing_to_log"]);
    for (const text of [JSON.stringify(notices), JSON.stringify(events), first.raw]) { expect(text).not.toContain(SECRET); expect(text).not.toContain("Morning\",\"body"); }
    expect(JSON.stringify(notices)).not.toContain("Morning");
    expect(await owned(peer, (tx) => tx.select().from(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, token.connectionId)))).toEqual([]);
  });

  it("pushes a content-free notice after the log commits, and a failed push neither undoes nor hides it", async () => {
    await clearLogs();
    const token = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]);
    const [occurrence] = group((await schedule(token.access_token)).value, "Morning").occurrences;
    await withSystemContext(db, async (tx) => {
      await tx.update(users).set({ pushHealthRemindersEnabled: true }).where(eq(users.id, owner.userId));
      await tx.insert(pushSubscriptions).values({ userId: owner.userId, endpoint: "https://push.example.test/" + randomUUID(), p256dh: "synthetic-key", authKey: "synthetic-auth" });
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The provider's own error text carries the marker, to prove it is not what gets reported.
      push.deliver.mockReset().mockRejectedValueOnce(new Error(`${SECRET} Morning 08:00 push provider unavailable`));
      const first = await log(token.access_token, occurrence.occurrenceRef);
      expect(first.refused).toBe(false);
      expect(first.value).toMatchObject({ outcome: "logged", logged: 4 });
      await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(push.deliver).toHaveBeenCalledTimes(1);
      const sent = push.deliver.mock.calls[0][2] as { userId: string; subscriptions: unknown[]; title: string; body: string };
      expect(sent).toMatchObject({ userId: owner.userId, householdId: owner.householdId, url: "/health" });
      expect(sent.subscriptions).toHaveLength(1);
      for (const text of [sent.title, sent.body, JSON.stringify(errors.mock.calls)]) {
        expect(text).not.toContain(SECRET); expect(text).not.toContain("Morning"); expect(text).not.toContain("08:00");
      }
      expect(errors.mock.calls[0]).toEqual(["[mcp] after-commit step failed", { tool: "log_medication_group", connectionId: token.connectionId, error: "Error" }]);
      // The log, its activity row and the in-app notice all stand.
      expect(await doseLogs(Object.values(meds))).toHaveLength(4);
      expect((await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)))).map((event) => event.outcome)).toEqual(["logged"]);
      expect(await owned(owner, (tx) => tx.select().from(userNotifications).where(and(eq(userNotifications.userId, owner.userId), sql`${userNotifications.tag} like ${"mcp-med:" + token.connectionId + "%"}`)))).toHaveLength(1);

      // A delivery that works reports nothing. The entries are cleared so there is something to log again.
      push.deliver.mockReset().mockResolvedValueOnce(undefined);
      await clearLogs();
      expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "logged" });
      await vi.waitFor(() => expect(push.deliver).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(errors).toHaveBeenCalledTimes(1);

      // With health pushes off the member still has the in-app notice, and nothing is pushed.
      await withSystemContext(db, (tx) => tx.update(users).set({ pushHealthRemindersEnabled: false }).where(eq(users.id, owner.userId)));
      push.deliver.mockReset().mockResolvedValue(undefined);
      await clearLogs();
      expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "logged" });
      // Nothing to wait on for an absence, so let the detached step finish by making one more round trip.
      await schedule(token.access_token);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(push.deliver).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      push.deliver.mockReset();
      await withSystemContext(db, async (tx) => {
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, owner.userId));
        await tx.update(users).set({ pushHealthRemindersEnabled: false }).where(eq(users.id, owner.userId));
      });
    }
  });

  it("marks an entry as assistant-recorded until the member changes it themselves", async () => {
    await clearLogs();
    const token = await connect([READ, LOG], [{ groupId: night, canLog: true, alias: "Night" }]);
    const [occurrence] = group((await schedule(token.access_token)).value, "Night").occurrences;
    expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "logged", logged: 1 });
    const [recorded] = await doseLogs([meds.d]);
    expect(recorded).toMatchObject({ status: "taken", loggedViaConnectionId: token.connectionId });
    // The member's own correction in the app is a single-dose action: it wins and the entry becomes theirs.
    const [med] = await owned(owner, (tx) => tx.select().from(healthMedications).where(eq(healthMedications.id, meds.d)));
    const corrected = await owned(owner, (tx) => recordDose(tx, env, { med, householdId: owner.householdId, loggedByUserId: owner.userId, status: "skipped", scheduledAt: recorded.scheduledAt, loggedAt: new Date(), source: "single" }));
    expect(corrected.outcome).toBe("updated");
    expect(corrected.log).toMatchObject({ status: "skipped", recordedByAssistant: false });
    expect((await doseLogs([meds.d]))[0]).toMatchObject({ status: "skipped", loggedViaConnectionId: null });
    // The assistant cannot turn that skip back into "taken".
    expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "nothing_to_log", logged: 0, alreadyRecorded: 1 });
    expect((await doseLogs([meds.d]))[0]).toMatchObject({ status: "skipped" });
    // Disconnecting keeps the dose history and only drops the link to the connection.
    const again = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]);
    const [morningOccurrence] = group((await schedule(again.access_token)).value, "Morning").occurrences;
    await log(again.access_token, morningOccurrence.occurrenceRef);
    expect((await doseLogs([meds.a]))[0]).toMatchObject({ loggedViaConnectionId: again.connectionId });
    await auth.mcp.revokeConnection(owner.headers, again.connectionId);
    expect((await doseLogs([meds.a]))[0]).toMatchObject({ status: "taken", loggedViaConnectionId: again.connectionId });
  });

  it("fills gaps only: a deliberate skip and an in-app entry are left alone", async () => {
    await clearLogs();
    const token = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]);
    const { value } = await schedule(token.access_token, "yesterday");
    const [occurrence] = group(value, "Morning").occurrences;
    const instant = new Date((await owned(owner, (tx) => tx.execute<{ at: string }>(sql`select (${value.date + " 08:00"}::timestamp at time zone (select timezone from households where id = ${owner.householdId})) as at`)))[0].at);
    await owned(owner, (tx) => tx.insert(healthMedicationLogs).values([{ medicationId: meds.b, scheduledAt: instant, status: "skipped", loggedByUserId: owner.userId }, { medicationId: meds.a, scheduledAt: instant, status: "taken", loggedByUserId: owner.userId }]));
    expect(group((await schedule(token.access_token, "yesterday")).value, "Morning").occurrences[0]).toMatchObject({ status: "mixed" });
    expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "logged", logged: 2, alreadyRecorded: 2, notAccessible: 0 });
    const rows = await doseLogs([meds.a, meds.b, meds.c, meds.d]);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.medicationId === meds.b)).toMatchObject({ status: "skipped", loggedViaConnectionId: null });
    expect(rows.find((row) => row.medicationId === meds.a)).toMatchObject({ status: "taken", loggedViaConnectionId: null });
  });

  it("does not extend access to a medication added later until the member approves it", async () => {
    await clearLogs();
    const token = await connect([READ, LOG], [{ groupId: night, canLog: true, alias: "Night" }]);
    const added = await medication(owner, "AddedLater", ["20:00"]); meds.added = added;
    await owned(owner, (tx) => tx.insert(healthMedicationGroupMembers).values({ groupId: night, medicationId: added }));
    const [occurrence] = group((await schedule(token.access_token)).value, "Night").occurrences;
    expect(occurrence).toMatchObject({ total: 2, notAccessibleToAssistant: 1 });
    expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "logged", logged: 1, notAccessible: 1 });
    expect((await doseLogs([added]))).toEqual([]);
    const path = `/api/mcp-auth/connections/${token.connectionId}/health-groups`;
    const view = async () => (await (await post(path + "/view", {})).json() as { selections: { groupId: string; medications: { id: string; state: string }[] }[] }).selections.find((entry) => entry.groupId === night)!;
    expect((await view()).medications.find((med) => med.id === added)).toMatchObject({ state: "new" });
    // Approving shares more than before, so it needs the acknowledgment; it is one step for the whole group.
    expect((await post(path, { groups: [{ groupId: night, canLog: true, alias: "Night" }] })).status).toBe(400);
    expect((await post(path, { groups: [{ groupId: night, canLog: true, alias: "Night" }], acknowledged: true }, peer)).status).toBe(403);
    expect((await post(path, { groups: [{ groupId: night, canLog: true, alias: "Night" }], acknowledged: true })).status).toBe(200);
    expect((await log(token.access_token, occurrence.occurrenceRef)).value).toMatchObject({ outcome: "logged", logged: 1, alreadyRecorded: 1, notAccessible: 0 });
    // Narrowing needs no acknowledgment.
    expect((await post(path, { groups: [{ groupId: night, canLog: true, alias: "Night", excludedMedicationIds: [added] }] })).status).toBe(200);
    expect((await view()).medications.find((med) => med.id === added)).toMatchObject({ state: "excluded" });
    // Removing it from the group forgets the decision, so adding it back is "new" again.
    await owned(owner, (tx) => tx.delete(healthMedicationGroupMembers).where(and(eq(healthMedicationGroupMembers.groupId, night), eq(healthMedicationGroupMembers.medicationId, added))));
    expect(await owned(owner, (tx) => tx.select().from(mcpMedGroupMemberConsents).where(eq(mcpMedGroupMemberConsents.medicationId, added)))).toEqual([]);
    await owned(owner, (tx) => tx.insert(healthMedicationGroupMembers).values({ groupId: night, medicationId: added }));
    expect((await view()).medications.find((med) => med.id === added)).toMatchObject({ state: "new" });
    await owned(owner, (tx) => tx.delete(healthMedicationGroupMembers).where(and(eq(healthMedicationGroupMembers.groupId, night), eq(healthMedicationGroupMembers.medicationId, added))));
  });

  it("writes nothing for a changed schedule, a foreign or altered reference, or a group it may not log", async () => {
    await clearLogs();
    const first = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]);
    const stale = group((await schedule(first.access_token)).value, "Morning").occurrences[0].occurrenceRef;
    const token = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }, { groupId: night, canLog: false, alias: "Night", shareCounts: false }]);
    const current = (await schedule(token.access_token)).value;
    const morningRef = group(current, "Morning").occurrences[0].occurrenceRef, nightOccurrence = group(current, "Night").occurrences[0];
    // Without count sharing there are no counts to read.
    expect(Object.keys(nightOccurrence).sort()).toEqual(["localTime", "occurrenceRef", "status"]);
    const nothing = async (reference: string, outcome: string) => {
      const result = await log(token.access_token, reference);
      expect(result.value, result.raw).toMatchObject({ outcome });
      expect(await doseLogs(Object.values(meds))).toEqual([]);
      return result.value!;
    };
    await nothing(stale, "target_changed");                                         // issued to the previous connection
    await nothing(morningRef.slice(0, -2) + (morningRef.endsWith("AA") ? "BB" : "AA"), "target_changed");
    await nothing("not-a-reference", "target_changed");
    expect(await nothing(nightOccurrence.occurrenceRef, "not_permitted")).not.toHaveProperty("logged");
    await owned(owner, (tx) => tx.update(healthMedicationGroups).set({ scheduleJson: JSON.stringify({ times: ["08:30"] }) }).where(eq(healthMedicationGroups.id, morning)));
    try { await nothing(morningRef, "target_changed"); }
    finally { await owned(owner, (tx) => tx.update(healthMedicationGroups).set({ scheduleJson: JSON.stringify({ times: ["08:00"] }) }).where(eq(healthMedicationGroups.id, morning))); }
    // Every medication excluded: the group is shared and loggable, yet nothing is permitted.
    const none = await connect([READ, LOG], [{ groupId: night, canLog: true, alias: "Night", excludedMedicationIds: [meds.d] }]);
    const result = await log(none.access_token, group((await schedule(none.access_token)).value, "Night").occurrences[0].occurrenceRef);
    expect(result.value).toMatchObject({ outcome: "not_permitted", logged: 0, notAccessible: 1 });
    expect(await doseLogs(Object.values(meds))).toEqual([]);
  });

  it("reports only completeness when count sharing is off", async () => {
    await clearLogs();
    const token = await connect([READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning", shareCounts: false, excludedMedicationIds: [meds.c] }]);
    const [occurrence] = group((await schedule(token.access_token)).value, "Morning").occurrences;
    const result = await log(token.access_token, occurrence.occurrenceRef);
    expect(result.value).toEqual({ outcome: "logged", label: "Morning", date: expect.any(String), localTime: "08:00", complete: false });
    expect(await doseLogs(Object.values(meds))).toHaveLength(3);
  });

  it("follows the member, the operator and the household module on the next call", async () => {
    await clearLogs();
    const token = await connect(["shopping.read", READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]);
    const reference = group((await schedule(token.access_token)).value, "Morning").occurrences[0].occurrenceRef;
    const health = ["get_medication_group_schedule", "log_medication_group"];
    // Operator ceiling without the action: reading stays, logging goes.
    const readOnly = gateway({ MCP_DIRECT_ACTIONS_ENABLED: false });
    expect(await names(token.access_token, readOnly)).toEqual(["get_connection_context", "list_shopping_items", "get_medication_group_schedule"]);
    expect((await log(token.access_token, reference, readOnly)).refused).toBe(true);
    // Household switches the health module off: health tools go, the rest of the connection keeps working.
    await owned(owner, (tx) => tx.update(households).set({ modulesEnabled: '["core"]' }).where(eq(households.id, owner.householdId)));
    try {
      expect(await names(token.access_token)).toEqual(["get_connection_context", "list_shopping_items"]);
      expect((await log(token.access_token, reference)).refused).toBe(true);
      expect((await post("/api/mcp-auth/health-groups", { householdId: owner.householdId })).status).toBe(403);
      // Sharing a group is refused while the module is off; what is stored stays as it was.
      expect((await post(`/api/mcp-auth/connections/${token.connectionId}/health-groups`, { groups: [{ groupId: morning, canLog: true, alias: "Renamed" }], acknowledged: true })).status).not.toBe(200);
      expect((await owned(owner, (tx) => tx.select().from(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, token.connectionId)))).map((row) => row.canLog)).toEqual([true]);
      // Narrowing is still allowed with the module off: here one medication is unticked and nothing else changes.
      expect((await post(`/api/mcp-auth/connections/${token.connectionId}/health-groups`, { groups: [{ groupId: morning, canLog: true, alias: "Morning", excludedMedicationIds: [meds.a] }] })).status).toBe(200);
      expect((await owned(owner, (tx) => tx.select().from(mcpMedGroupMemberConsents).where(and(eq(mcpMedGroupMemberConsents.connectionId, token.connectionId), eq(mcpMedGroupMemberConsents.medicationId, meds.a))))).map((row) => row.state)).toEqual(["excluded"]);
    } finally { await owned(owner, (tx) => tx.update(households).set({ modulesEnabled: '["core","health"]' }).where(eq(households.id, owner.householdId))); }
    expect(await doseLogs(Object.values(meds))).toEqual([]);
    // Member switches logging off: the tool goes and stored selections lose it.
    const capabilities = `/api/mcp-auth/connections/${token.connectionId}/capabilities`;
    expect((await post(capabilities, { capabilities: ["shopping.read", LOG] })).status).toBe(400);
    expect((await post(capabilities, { capabilities: ["shopping.read", READ] })).status).toBe(200);
    expect(await names(token.access_token)).not.toContain("log_medication_group");
    expect((await owned(owner, (tx) => tx.select().from(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, token.connectionId)))).map((row) => row.canLog)).toEqual([false]);
    // Switching reading off forgets the shared groups entirely.
    expect((await post(capabilities, { capabilities: ["shopping.read"] })).status).toBe(200);
    expect(await names(token.access_token)).toEqual(["get_connection_context", "list_shopping_items"]);
    expect(await owned(owner, (tx) => tx.select().from(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, token.connectionId)))).toEqual([]);
    for (const name of health) expect((await rpc(token.access_token, "tools/call", { name, arguments: name === health[0] ? {} : { occurrenceRef: reference } })).result?.isError ?? true).toBeTruthy();
    expect(await doseLogs(Object.values(meds))).toEqual([]);
  });

  it("keeps reads working when the operator withdraws an action, through a token refresh, and restores it without a reconnect", async () => {
    await clearLogs();
    const token = await connect(["shopping.read", READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]) as Awaited<ReturnType<typeof connect>> & { refresh_token: string };
    const reference = group((await schedule(token.access_token)).value, "Morning").occurrences[0].occurrenceRef;
    const reads = ["get_connection_context", "list_shopping_items", "get_medication_group_schedule"];
    // The whole deployment, not only the gateway, now runs without direct actions: health:write is no longer offered.
    const offEnv = { ...env, MCP_DIRECT_ACTIONS_ENABLED: false } as Env;
    const off = createBetterAuth(db, offEnv, { cookiePrefix, deferHouseholdMembership: async () => true });
    const target = mcpGateway(db, off.mcp, offEnv);
    const originalAuth = auth;
    let refreshed: { access_token: string; refresh_token: string };
    // The loopback server's auth handlers resolve this variable per request.
    auth = off;
    try {
      expect((await (await target.request(origin + "/.well-known/oauth-protected-resource/api/mcp")).json() as { scopes_supported: string[] }).scopes_supported).not.toContain("health:write");
      // The grant still holds health:write. Its reads carry on; only the action is gone.
      expect(await names(token.access_token, target)).toEqual(reads);
      expect(group((await schedule(token.access_token, "today", target)).value, "Morning").occurrences).toHaveLength(1);
      expect((await log(token.access_token, reference, target)).refused).toBe(true);
      expect(await doseLogs(Object.values(meds))).toEqual([]);
      const response = await fetch(origin + "/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token.refresh_token, resource: origin + "/api/mcp" }) });
      expect(response.status, await response.clone().text()).toBe(200);
      refreshed = await response.json() as typeof refreshed;
      expect(await names(refreshed.access_token, target)).toEqual(reads);
      expect((await log(refreshed.access_token, reference, target)).refused).toBe(true);
    } finally { auth = originalAuth; }
    // Offered again: the same grant logs without the member reconnecting.
    expect(await names(refreshed!.access_token)).toEqual([...reads, "log_medication_group"]);
    expect((await log(refreshed!.access_token, reference)).value).toMatchObject({ outcome: "logged" });
  });

  it("drops logging when narrowing removes the scope its read depends on", async () => {
    const token = await connect(["shopping.read", READ, LOG], [{ groupId: morning, canLog: true, alias: "Morning" }]);
    const narrowed = await post(`/api/mcp-auth/connections/${token.connectionId}/narrow`, { scopes: ["shopping:read", "health:write", "offline_access"], noteIds: [] });
    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    const kept = await owned(owner, (tx) => tx.select({ capability: mcpConnectionCapabilities.capability }).from(mcpConnectionCapabilities).where(eq(mcpConnectionCapabilities.connectionId, token.connectionId)));
    // health:write is still granted, but logging has nothing to build on, so it does not linger as an orphan.
    expect(kept.map((row) => row.capability)).toEqual(["shopping.read"]);
    expect(await owned(owner, (tx) => tx.select().from(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, token.connectionId)))).toEqual([]);
    expect((await post(`/api/mcp-auth/connections/${token.connectionId}/capabilities`, { capabilities: ["shopping.read"] })).status).toBe(200);
  });

  it("previews the exact schedule payload for unsaved choices without naming a medication", async () => {
    const response = await post("/api/mcp-auth/health-groups/preview", { householdId: owner.householdId, groups: [{ groupId: morning, canLog: true, alias: null, excludedMedicationIds: [meds.c] }] });
    expect(response.status, await response.clone().text()).toBe(200);
    const preview = await response.json() as { tool: string; payload: Schedule };
    expect(preview.tool).toBe("get_medication_group_schedule");
    // With no alias the real group name is what would be shared, and the member sees that here first.
    expect(preview.payload.data[0].label).toBe(`${SECRET} Morning`.slice(0, 40));
    expect(preview.payload.data[0].occurrences[0]).toMatchObject({ localTime: "08:00", total: 4, notAccessibleToAssistant: 1 });
    expect(JSON.stringify(preview)).not.toContain(`${SECRET} A`);
    expect((await post("/api/mcp-auth/health-groups/preview", { householdId: owner.householdId, groups: [{ groupId: peerGroup, canLog: false }] }).then((r) => r.json()) as { payload: Schedule }).payload.data).toEqual([]);
    expect((await post("/api/mcp-auth/health-groups/preview", { householdId: stranger.householdId, groups: [] })).status).toBe(403);
  });
});
