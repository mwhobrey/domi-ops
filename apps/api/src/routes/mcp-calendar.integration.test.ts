import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import { createBetterAuth, MCP_CAPABILITY_CONSENT_VERSION, MCP_POLICY_VERSION } from "@domi-ops/auth";
import { envSchema, type Env } from "@domi-ops/config";
import { addDaysIso, todayIsoDateInTz } from "@domi-ops/calendar-sync";
import {
  createDb, closeDb, calendarEvents, calendars, householdMembers, households, users, householdSubscriptions, oauthClient, recurringRules,
  mcpAccessEvents, mcpCalendarSelections, mcpConnectionCapabilities, mcpConnections,
  withSystemContext, withUserLookupContext, withHouseholdContext, withMcpProviderContext, type Database,
} from "@domi-ops/db";
import { mcpAuthorizationRoutes } from "./mcp-authorization.js";
import { mcpGateway } from "../mcp/gateway.js";

const url = process.env.MCP_TEST_DATABASE_URL ?? process.env.HOSTED_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
type Person = { userId: string; memberId: string; householdId: string; headers: Headers };
type Busy = { start: string; end: string; allDay: boolean };
type Availability = { coverage: string; externalCalendarsExcluded: boolean; truncated: boolean; recurringExpanded: boolean; householdTimezone: string; from: string; to: string; busy: Busy[] };
const scopes = ["shopping:read", "calendar:read", "offline_access"];
const CAPABILITY = "calendar.availability", TOOL = "get_calendar_availability";
// Every calendar name, title, description and location carries this marker so one assertion proves none of them leaked.
const SECRET = "Fictional-secret-cal";

for (const mode of ["single", "shared"] as const) suite(`MCP calendar availability (${mode}, restricted role)`, () => {
  let db: Database, auth: ReturnType<typeof createBetterAuth>, env: Env, server: ReturnType<typeof serve>, origin: string, clientId: string;
  let owner: Person, peer: Person, stranger: Person;
  let family: string, mine: string, peerPrivate: string, foreign: string;
  const householdIds: string[] = [], userIds: string[] = [], clientIds: string[] = [];
  const callback = "https://synthetic-assistant.example.test/calendar", verifier = "k".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  // The household runs on UTC, so local times in a response equal the stored times.
  const day = addDaysIso(todayIsoDateInTz("UTC"), 3), at = (offset: number, time: string) => addDaysIso(day, offset) + "T" + time;
  const gateway = (overrides: Partial<Env> = {}) => mcpGateway(db, auth.mcp, { ...env, ...overrides });

  async function owned<T>(person: Person, fn: (tx: Database) => Promise<T>) {
    return withUserLookupContext(db, person.userId, (lookup) => withHouseholdContext(lookup, person.householdId, fn));
  }
  async function post(path: string, body: unknown, person = owner) {
    return fetch(origin + path, { method: "POST", headers: person.headers, body: JSON.stringify(body) });
  }
  /** Consent goes through the HTTP route so the calendar selection is written in the grant's own transaction. */
  async function prepare(capabilities: string[] | undefined, calendarIds?: string[], person = owner) {
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback, scope: scopes.join(" "), resource: origin + "/api/mcp", state: randomUUID(), code_challenge: challenge, code_challenge_method: "S256" });
    const start = await fetch(origin + "/auth/oauth2/authorize?" + query, { headers: person.headers, redirect: "manual" });
    const location = start.headers.get("location") ?? (await start.json() as { url: string }).url;
    const oauthQuery = new URL(location, origin).searchParams.toString();
    const response = await post("/api/mcp-auth/consents/prepare", { householdId: person.householdId, oauthQuery, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true,
      policyVersion: MCP_POLICY_VERSION, ...(capabilities ? { capabilities } : {}), ...(calendarIds ? { calendarIds } : {}) }, person);
    return { response, oauthQuery };
  }
  async function connect(capabilities: string[] | undefined, calendarIds?: string[], person = owner) {
    const { response, oauthQuery } = await prepare(capabilities, calendarIds, person);
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
    return { raw: text, ...JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : text) as {
      error?: unknown; result: { tools?: { name: string; annotations?: Record<string, unknown> }[]; isError?: boolean; structuredContent?: Record<string, unknown> } } };
  }
  // An unlisted tool is a protocol error; a listed one that is refused reports isError.
  const refused = (response: Awaited<ReturnType<typeof rpc>>) => response.error !== undefined || response.result?.isError === true;
  const names = async (token: string, target = gateway()) => (await rpc(token, "tools/list", undefined, target)).result.tools!.map((tool) => tool.name);
  const call = (token: string, args: Record<string, unknown>, target = gateway()) => rpc(token, "tools/call", { name: TOOL, arguments: args }, target);
  const availability = async (token: string, args: Record<string, unknown> = { from: day, to: addDaysIso(day, 3) }) => {
    const response = await call(token, args);
    expect(refused(response), response.raw).toBe(false);
    return response.result.structuredContent as unknown as Availability;
  };
  const selections = (connectionId: string) => owned(owner, async (tx) => (await tx.select({ id: mcpCalendarSelections.calendarId }).from(mcpCalendarSelections).where(eq(mcpCalendarSelections.connectionId, connectionId))).map((row) => row.id).sort());
  const saveCalendars = (connectionId: string, body: unknown, person = owner) => post(`/api/mcp-auth/connections/${connectionId}/calendars`, body, person);
  const setCapabilities = (connectionId: string, body: unknown) => post(`/api/mcp-auth/connections/${connectionId}/capabilities`, body);

  async function calendar(person: Person, name: string, visibility: "household" | "private") {
    const [row] = await owned(person, (tx) => tx.insert(calendars).values({ householdId: person.householdId, name: `${SECRET} ${name}`, visibility, ownerUserId: visibility === "private" ? person.userId : null }).returning({ id: calendars.id }));
    return row.id;
  }
  async function event(person: Person, calendarId: string, offset: number, startTime: string | null, endTime: string | null, extra: Partial<typeof calendarEvents.$inferInsert> = {}) {
    await owned(person, (tx) => tx.insert(calendarEvents).values({ householdId: person.householdId, calendarId, title: `${SECRET} title`, description: `${SECRET} description`, location: `${SECRET} place`,
      categoryKey: "secretcat", startDate: addDaysIso(day, offset), startTime, endTime, allDay: startTime === null, source: "local", createdByUserId: person.userId, ...extra }));
  }
  // What the family calendar looks like across the four-day window, with nothing else selected.
  const familyBusy: Busy[] = [
    { start: at(0, "13:00"), end: at(0, "15:00"), allDay: false },
    { start: at(0, "15:30"), end: at(0, "17:15"), allDay: false },
    { start: at(1, "00:00"), end: at(2, "00:00"), allDay: true },
    { start: at(2, "07:00"), end: at(2, "07:30"), allDay: false },
    { start: at(3, "07:00"), end: at(3, "07:30"), allDay: false },
  ];

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
      SESSION_SECRET: "synthetic-who469-session-secret-for-disposable-fixtures-only",
      MCP_ENABLED: "true", MCP_SYNTHETIC_DEPLOYMENT: "true", MCP_READ_SCOPES: "shopping:read,calendar:read", MODULES_ENABLED: "core,calendar_sync" });
    auth = createBetterAuth(db, env, { cookiePrefix: "cal" + randomUUID().replaceAll("-", ""), deferHouseholdMembership: async () => true });
    app.all("/auth/*", (c) => auth.handler(c.req.raw));
    app.route("/api/mcp-auth", mcpAuthorizationRoutes(auth.mcp, env));
    for (let i = 0; i < 2; i++) {
      const [household] = await withSystemContext(db, (tx) => tx.insert(households).values({ name: "Fictional calendar household", timezone: "UTC", modulesEnabled: '["core","calendar_sync"]' }).returning());
      householdIds.push(household.id);
    }
    const signup = async (householdId: string, role: "owner" | "member"): Promise<Person> => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let response: Response;
      try { response = await fetch(origin + "/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Fictional Calendar Member", email: randomUUID() + "@example.test", password: "Synthetic-only-calendar-fixture-2026" }) }); }
      finally { warn.mockRestore(); }
      expect(response.status).toBe(200);
      const { user } = await response.json() as { user: { id: string } }; userIds.push(user.id);
      const [member] = await withSystemContext(db, (tx) => tx.insert(householdMembers).values({ householdId, userId: user.id, role }).returning());
      return { userId: user.id, memberId: member.id, householdId, headers: new Headers({ origin, "content-type": "application/json", cookie: response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") }) };
    };
    owner = await signup(householdIds[0], "owner"); peer = await signup(householdIds[0], "member"); stranger = await signup(householdIds[1], "owner");
    for (const person of [owner, stranger]) {
      await auth.mcp.setHouseholdEnabled(person.headers, person.householdId, true);
      await owned(person, (tx) => tx.insert(householdSubscriptions).values({ householdId: person.householdId, modulesEntitled: '["core","calendar_sync"]', status: "active" }));
    }
    const client = await auth.mcp.registerClient(owner.headers, { name: "Fictional calendar client", redirectUris: [callback], tokenEndpointAuthMethod: "none", scopes, provider: "local", profileVersion: "calendar.fixture.v1", dataMode: "synthetic", enabled: true });
    clientId = client.client_id; clientIds.push(clientId);

    family = await calendar(owner, "Family", "household"); mine = await calendar(owner, "Mine", "private");
    peerPrivate = await calendar(peer, "Peer", "private"); foreign = await calendar(stranger, "Foreign", "household");
    // Two back-to-back events, then one with drive buffers on both sides.
    await event(owner, family, 0, "13:00", "14:00"); await event(owner, family, 0, "14:00", "15:00");
    await event(owner, family, 0, "16:00", "17:00", { driveBufferBeforeMinutes: 30, driveBufferAfterMinutes: 15 });
    await event(owner, family, 1, null, null);
    // Imported from Google: never part of an answer, and the answer says something was left out.
    await event(owner, family, 0, "09:00", "10:00", { source: "google", googleEventId: "fictional-google-event" });
    // A daily series with nothing stored yet. Reported as free, it would be worse than no answer.
    await owned(owner, (tx) => tx.insert(recurringRules).values({ householdId: owner.householdId, calendarId: family, title: `${SECRET} series`, rrule: "FREQ=DAILY", startDate: addDaysIso(day, 2), startTime: "07:00", endTime: "07:30" }));
    await event(owner, mine, 0, "20:00", "21:00");
    await event(peer, peerPrivate, 0, "10:00", "11:00");
    await event(stranger, foreign, 0, "11:00", "12:00");
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

  it("never makes calendar access a default and validates calendar choices at consent", async () => {
    const plain = await connect(undefined);
    expect(plain.capabilities).toEqual(["shopping.read"]);
    expect(await names(plain.access_token)).not.toContain(TOOL);
    // Calendars without the capability, a calendar the member cannot see, another household's, and a repeat are all refused.
    expect((await prepare(["shopping.read"], [family])).response.status).toBe(400);
    for (const ids of [[peerPrivate], [foreign], [family, family], [randomUUID()]]) {
      const attempt = await prepare(["shopping.read", CAPABILITY], ids);
      expect(attempt.response.status, ids.join()).toBe(400);
      expect(await attempt.response.json()).toEqual({ error: "invalid_calendar_selection" });
    }
    const overview = await (await post("/api/mcp-auth/overview", { householdId: owner.householdId })).json() as { connections: { id: string; availableCapabilities: { name: string; access: string }[] }[] };
    expect(overview.connections.find((c) => c.id === plain.connectionId)!.availableCapabilities).toContainEqual({ name: CAPABILITY, access: "read" });
  });

  it("returns merged busy blocks and nothing that describes an event", async () => {
    const token = await connect(["shopping.read", CAPABILITY], [family]);
    expect(await selections(token.connectionId)).toEqual([family]);
    const listed = (await rpc(token.access_token, "tools/list")).result.tools!.find((tool) => tool.name === TOOL)!;
    expect(listed.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    const response = await call(token.access_token, { from: day, to: addDaysIso(day, 3) });
    const result = response.result.structuredContent as unknown as Availability;
    expect(result).toMatchObject({ coverage: "selected_calendars", externalCalendarsExcluded: true, truncated: false, recurringExpanded: true, householdTimezone: "UTC", from: day, to: addDaysIso(day, 3) });
    // The Google event at 09:00 is absent, the two meetings read as one block, and the unstored series is expanded.
    expect(result.busy).toEqual(familyBusy);
    for (const block of result.busy) expect(Object.keys(block).sort()).toEqual(["allDay", "end", "start"]);
    expect(Object.keys(result).sort()).toEqual(["busy", "coverage", "externalCalendarsExcluded", "from", "householdTimezone", "recurringExpanded", "retrievedAt", "schemaVersion", "to", "truncated"]);
    for (const leaked of [SECRET, "secretcat", "fictional-google-event", family, mine]) expect(response.raw).not.toContain(leaked);
    // Reading availability stores nothing: the series still has no events.
    const stored = await owned(owner, (tx) => tx.select({ id: calendarEvents.id }).from(calendarEvents).where(sql`${calendarEvents.recurringRuleId} is not null and ${calendarEvents.householdId} = ${owner.householdId}`));
    expect(stored).toEqual([]);
    // A single day needs no end date.
    expect((await availability(token.access_token, { from: day })).busy).toEqual(familyBusy.slice(0, 2));
  });

  it("says so when no calendar is shared, instead of reporting free time", async () => {
    const token = await connect(["shopping.read", CAPABILITY]);
    expect(await names(token.access_token)).toContain(TOOL);
    expect(await availability(token.access_token)).toMatchObject({ coverage: "no_calendars_selected", externalCalendarsExcluded: false, busy: [] });
  });

  it("changes the shared calendars in Domi Ops with an acknowledgment, for the grant's own member only", async () => {
    const token = await connect(["shopping.read", CAPABILITY], [family]);
    const view = await (await post(`/api/mcp-auth/connections/${token.connectionId}/calendars/view`, {})).json() as { calendars: { id: string; name: string }[]; calendarIds: string[] };
    expect(view.calendarIds).toEqual([family]);
    // The member's own browser sees names; their own private calendar is offered, a peer's is not.
    expect(view.calendars.map((entry) => entry.id).sort()).toEqual([family, mine].sort());
    expect((await saveCalendars(token.connectionId, { calendarIds: [family, mine] })).status).toBe(400);
    for (const person of [peer, stranger]) expect((await saveCalendars(token.connectionId, { calendarIds: [family], acknowledged: true }, person)).status).not.toBe(200);
    expect((await saveCalendars(token.connectionId, { calendarIds: [family, peerPrivate], acknowledged: true })).status).toBe(400);
    expect(await selections(token.connectionId)).toEqual([family]);
    expect((await saveCalendars(token.connectionId, { calendarIds: [family, mine], acknowledged: true })).status).toBe(200);
    const evening = { start: at(0, "20:00"), end: at(0, "21:00"), allDay: false };
    expect((await availability(token.access_token)).busy).toContainEqual(evening);
    // Removing a calendar needs no acknowledgment and applies on the next call.
    expect((await saveCalendars(token.connectionId, { calendarIds: [mine] })).status).toBe(200);
    const narrowed = await availability(token.access_token);
    expect(narrowed.busy).toEqual([evening]);
    expect(narrowed.externalCalendarsExcluded).toBe(false);
  });

  it("stops sharing a calendar the member can no longer see", async () => {
    const shared = await calendar(peer, "Lent", "household");
    await event(peer, shared, 0, "05:00", "06:00");
    const token = await connect(["shopping.read", CAPABILITY], [shared]);
    const early = { start: at(0, "05:00"), end: at(0, "06:00"), allDay: false };
    expect((await availability(token.access_token)).busy).toEqual([early]);
    // Its owner makes it private: the selection row stays, the access does not.
    await owned(peer, (tx) => tx.update(calendars).set({ visibility: "private", ownerUserId: peer.userId }).where(eq(calendars.id, shared)));
    expect(await availability(token.access_token)).toMatchObject({ coverage: "no_calendars_selected", busy: [] });
    await owned(peer, (tx) => tx.update(calendars).set({ visibility: "household", ownerUserId: null }).where(eq(calendars.id, shared)));
    expect((await availability(token.access_token)).busy).toEqual([early]);
    await owned(peer, (tx) => tx.update(calendars).set({ archived: true }).where(eq(calendars.id, shared)));
    expect((await availability(token.access_token)).busy).toEqual([]);
    // Deleting the calendar removes the selection with it.
    await owned(peer, (tx) => tx.delete(calendars).where(eq(calendars.id, shared)));
    expect(await selections(token.connectionId)).toEqual([]);
  });

  it("refuses a range it does not serve and any argument it does not define", async () => {
    const token = await connect(["shopping.read", CAPABILITY], [family]);
    const today = todayIsoDateInTz("UTC");
    for (const args of [{}, { from: day, to: addDaysIso(day, 14) }, { from: addDaysIso(day, 1), to: day }, { from: addDaysIso(today, -40) }, { from: addDaysIso(today, 400) },
      { from: day, calendarId: family }, { from: day, includeTitles: true }, { from: "tomorrow" }]) {
      expect(refused(await call(token.access_token, args)), JSON.stringify(args)).toBe(true);
    }
    expect((await availability(token.access_token, { from: day, to: addDaysIso(day, 13) })).truncated).toBe(false);
  });

  it("follows the member's switch, the granted scope and the household module on the next call", async () => {
    const token = await connect(["shopping.read", CAPABILITY], [family]);
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.read"] })).status).toBe(200);
    expect(await names(token.access_token)).not.toContain(TOOL);
    expect(refused(await call(token.access_token, { from: day }))).toBe(true);
    // Switching it back on starts with no calendars chosen.
    expect(await selections(token.connectionId)).toEqual([]);
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.read", CAPABILITY] })).status).toBe(400);
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.read", CAPABILITY], acknowledged: true })).status).toBe(200);
    expect(await availability(token.access_token)).toMatchObject({ coverage: "no_calendars_selected", busy: [] });
    expect((await saveCalendars(token.connectionId, { calendarIds: [family], acknowledged: true })).status).toBe(200);
    expect((await availability(token.access_token)).busy).toEqual(familyBusy);
    // The household switches the module off: the tool disappears and the rest of the connection keeps working.
    await withSystemContext(db, (tx) => tx.update(households).set({ modulesEnabled: '["core"]' }).where(eq(households.id, owner.householdId)));
    try {
      const listed = await names(token.access_token);
      expect(listed).not.toContain(TOOL);
      expect(listed).toContain("list_shopping_items");
      expect(refused(await call(token.access_token, { from: day }))).toBe(true);
      expect((await post("/api/mcp-auth/calendars/preview", { householdId: owner.householdId, calendarIds: [family] })).status).not.toBe(200);
    } finally { await withSystemContext(db, (tx) => tx.update(households).set({ modulesEnabled: '["core","calendar_sync"]' }).where(eq(households.id, owner.householdId))); }
    // An operator that stops offering the tool's module removes it too.
    expect(await names(token.access_token, gateway({ MODULES_ENABLED: ["core"] }))).not.toContain(TOOL);
    // Narrowing the grant removes the capability and forgets the calendars.
    expect((await post(`/api/mcp-auth/connections/${token.connectionId}/narrow`, { scopes: ["shopping:read", "offline_access"], noteIds: [] })).status).toBe(200);
    expect(await selections(token.connectionId)).toEqual([]);
    expect((await owned(owner, (tx) => tx.select({ capability: mcpConnectionCapabilities.capability }).from(mcpConnectionCapabilities).where(eq(mcpConnectionCapabilities.connectionId, token.connectionId)))).map((row) => row.capability)).toEqual(["shopping.read"]);
  });

  it("previews the exact payload for unsaved choices and lists calendars to their member only", async () => {
    const before = await owned(owner, (tx) => tx.select({ id: mcpConnections.id }).from(mcpConnections).where(eq(mcpConnections.householdId, owner.householdId)));
    const list = await (await post("/api/mcp-auth/calendars", { householdId: owner.householdId })).json() as { calendars: { id: string; name: string; visibility: string }[] };
    expect(list.calendars.map((entry) => entry.id).sort()).toEqual([family, mine].sort());
    expect(list.calendars.every((entry) => entry.name.startsWith(SECRET))).toBe(true);
    const preview = await post("/api/mcp-auth/calendars/preview", { householdId: owner.householdId, calendarIds: [family] });
    const text = await preview.text();
    expect(preview.status, text).toBe(200);
    const body = JSON.parse(text) as { tool: string; payload: Availability };
    expect(body.tool).toBe(TOOL);
    // Seven days from the household's today, which includes the fixture day.
    expect(body.payload).toMatchObject({ coverage: "selected_calendars", externalCalendarsExcluded: true, from: todayIsoDateInTz("UTC"), to: addDaysIso(todayIsoDateInTz("UTC"), 6) });
    expect(body.payload.busy).toEqual(expect.arrayContaining(familyBusy));
    expect(text).not.toContain(SECRET);
    expect((await post("/api/mcp-auth/calendars/preview", { householdId: owner.householdId, calendarIds: [peerPrivate] })).status).toBe(400);
    for (const person of [stranger]) {
      expect((await post("/api/mcp-auth/calendars", { householdId: owner.householdId }, person)).status).not.toBe(200);
      expect((await post("/api/mcp-auth/calendars/preview", { householdId: owner.householdId, calendarIds: [family] }, person)).status).not.toBe(200);
    }
    // A preview creates no grant.
    expect(await owned(owner, (tx) => tx.select({ id: mcpConnections.id }).from(mcpConnections).where(eq(mcpConnections.householdId, owner.householdId)))).toHaveLength(before.length);
  });

  it("records the tool name and outcome, and nothing about the calendar", async () => {
    const token = await connect(["shopping.read", CAPABILITY], [family]);
    await availability(token.access_token);
    const events = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
    expect(events.some((row) => row.tool === TOOL && row.outcome === "succeeded")).toBe(true);
    const recorded = JSON.stringify(events);
    // Arguments and results are never stored, so neither the calendar nor the requested dates can appear.
    for (const leaked of [SECRET, family, addDaysIso(day, 3)]) expect(recorded).not.toContain(leaked);
  });

  it("gives a grant prepared by an older build the reads it approved, and nothing more", async () => {
    // What an API build from before capabilities writes: a grant row with no capability rows and no consent version.
    const legacy = randomUUID(), now = new Date();
    const grant = { householdId: owner.householdId, memberId: owner.memberId, userId: owner.userId, clientId, issuer: origin + "/auth", resource: origin + "/api/mcp", grantedRole: "owner",
      policyVersion: MCP_POLICY_VERSION, clientProfileVersion: "calendar.fixture.v1", adultAttestedAt: now, privacyAttestedAt: now, expiresAt: new Date(now.getTime() + 3600_000) };
    await owned(owner, (tx) => tx.insert(mcpConnections).values({ ...grant, id: legacy, scopes: ["shopping:read", "calendar:read", "offline_access"] }));
    const capabilityRows = (id: string) => owned(owner, (tx) => tx.select({ capability: mcpConnectionCapabilities.capability, consentVersion: mcpConnectionCapabilities.consentVersion }).from(mcpConnectionCapabilities).where(eq(mcpConnectionCapabilities.connectionId, id)));
    // The scope it holds for calendars does not become calendar access.
    expect(await capabilityRows(legacy)).toEqual([{ capability: "shopping.read", consentVersion: "legacy.build" }]);
    // A revoked row gets nothing.
    const dead = randomUUID();
    await owned(owner, (tx) => tx.insert(mcpConnections).values({ ...grant, id: dead, scopes: ["shopping:read", "offline_access"], status: "revoked", revokedAt: now }));
    expect(await capabilityRows(dead)).toEqual([]);
    // The current build marks its grants, so a member who unticks everything is left with nothing switched on.
    const empty = await connect([]);
    expect(await capabilityRows(empty.connectionId)).toEqual([]);
    const [marked] = await owned(owner, (tx) => tx.select({ version: mcpConnections.capabilityConsentVersion }).from(mcpConnections).where(eq(mcpConnections.id, empty.connectionId)));
    expect(marked.version).toBe(MCP_CAPABILITY_CONSENT_VERSION);
    expect(await names(empty.access_token)).toEqual(["get_connection_context"]);
    await owned(owner, (tx) => tx.delete(mcpConnections).where(inArray(mcpConnections.id, [legacy, dead])));
  });
});
