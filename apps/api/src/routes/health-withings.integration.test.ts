import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { decryptSensitive, mintWithingsWebhookToken, verifyWithingsWebhookToken } from "@domi-ops/crypto";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthEvents,
  healthMemberAcl,
  healthWithingsLinks,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { consumeOAuthState, setOAuthState } from "../lib/oauth-state.js";
import { WITHINGS_OAUTH_PREFIX } from "../lib/withings.js";
import { healthWithingsRoutes } from "./health-withings.js";
import { integrationsWithingsRoutes } from "./integrations-withings.js";
import { encryptWithingsSecret, withingsExchangeCode, withingsSubscribe, withingsUnsubscribe } from "@domi-ops/calendar-sync";

// Redis and Withings are the two things outside the process; both are stubbed, everything else is real.
vi.mock("../lib/oauth-state.js", () => ({
  setOAuthState: vi.fn(async () => {}),
  consumeOAuthState: vi.fn(async () => null),
}));
vi.mock("@domi-ops/calendar-sync", async (importOriginal) => {
  const real = await importOriginal<typeof import("@domi-ops/calendar-sync")>();
  return {
    ...real,
    withingsExchangeCode: vi.fn(),
    withingsSubscribe: vi.fn(async () => {}),
    withingsUnsubscribe: vi.fn(async () => {}),
  };
});

/**
 * WHO-452: the Withings routes over HTTP against a real Postgres. Auth is faked by a parent app
 * that sets `auth` per request from the `x-as` header; the tenant middleware, RLS transaction and
 * routes below it are the real ones. Skipped without a database.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const KEY = "test-health-encryption-key-32chars!!";
const env = {
  MODULES_ENABLED: ["core", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ENCRYPTION_KEY: KEY,
  PUBLIC_APP_URL: "https://app.test.example",
  REDIS_URL: "redis://redis.test:6379",
  WITHINGS_CLIENT_ID: "client",
  WITHINGS_CLIENT_SECRET: "secret",
} as unknown as Env;

type Role = "owner" | "admin" | "member" | "child";
type Person = { userId: string; memberId: string; householdId: string; role: Role };
// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Json = any;

maybeDescribe("withings routes (integration)", () => {
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
  let householdId: string;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, Person> = {};

  async function seedHousehold(name: string, members: { key: string; role: Role }[]): Promise<string> {
    return withSystemContext(baseDb, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdIds.push(hh!.id);
      for (const m of members) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who452-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u!.id);
        const [row] = await tx
          .insert(householdMembers)
          .values({ householdId: hh!.id, userId: u!.id, role: m.role, name: m.key })
          .returning({ id: householdMembers.id });
        people[m.key] = { userId: u!.id, memberId: row!.id, householdId: hh!.id, role: m.role };
      }
      return hh!.id;
    });
  }

  const call = async (
    as: string,
    method: string,
    path: string,
    body?: unknown,
    init: { form?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; json: Json; headers: Headers }> => {
    const res = await app.request(path, {
      method,
      headers: {
        "x-as": as,
        ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.form ? new URLSearchParams(init.form).toString() : body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await res.text();
    let json: Json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };

  async function makeLink(over: Partial<typeof healthWithingsLinks.$inferInsert> = {}) {
    const [row] = await withHouseholdContext(baseDb, householdId, (tx) =>
      tx
        .insert(healthWithingsLinks)
        .values({
          householdId,
          memberId: people.ally!.memberId,
          withingsUserId: "9001",
          accessTokenEncrypted: encryptWithingsSecret("access-1", env),
          refreshTokenEncrypted: encryptWithingsSecret("refresh-1", env),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
          linkedByUserId: people.mom!.userId,
          backfillFrom: new Date("2026-01-01T00:00:00Z"),
          ...over,
        })
        .returning(),
    );
    return row!;
  }

  const reload = (id: string) =>
    withHouseholdContext(baseDb, householdId, async (tx) => {
      const [row] = await tx.select().from(healthWithingsLinks).where(eq(healthWithingsLinks.id, id));
      return row;
    });

  const webhookUrl = (link: { id: string; householdId: string }, secret = KEY) =>
    `/integrations/webhook?t=${encodeURIComponent(mintWithingsWebhookToken({ householdId: link.householdId, linkId: link.id }, secret))}`;

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    householdId = await seedHousehold("who452-home", [
      { key: "mom", role: "owner" },
      { key: "ally", role: "child" },
      { key: "sitter", role: "member" },
      { key: "reader", role: "member" },
      { key: "stranger", role: "member" },
    ]);
    await seedHousehold("who452-other", [{ key: "outsider", role: "owner" }]);

    // sitter may log and manage Ally's entries; reader may only see them.
    await withHouseholdContext(baseDb, householdId, (tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId, subjectMemberId: people.ally!.memberId, granteeMemberId: people.sitter!.memberId, eventsAccess: "write" },
        { householdId, subjectMemberId: people.ally!.memberId, granteeMemberId: people.reader!.memberId, eventsAccess: "read" },
      ]),
    );

    const scoped = createScopedDb(baseDb);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      const who = people[c.req.header("x-as") ?? ""];
      c.set("userId", who?.userId ?? null);
      c.set(
        "auth",
        who
          ? { userId: who.userId, householdId: who.householdId, memberId: who.memberId, email: null, username: null, name: null, role: who.role }
          : null,
      );
      return next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/withings", healthWithingsRoutes(scoped, env));
    app.route("/integrations", integrationsWithingsRoutes(scoped, env));
  }, 60_000);

  beforeEach(async () => {
    if (!baseDb) return;
    vi.clearAllMocks();
    await withHouseholdContext(baseDb, householdId, async (tx) => {
      await tx.delete(healthWithingsLinks).where(eq(healthWithingsLinks.householdId, householdId));
      await tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId));
    });
  });

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      await tx.delete(households).where(inArray(households.id, householdIds));
      await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(baseDb);
  });

  describe("who may connect", () => {
    it.each([
      ["the person themselves", "ally"],
      ["a parent", "mom"],
      ["someone granted events: write", "sitter"],
    ])("lets %s start a link, with the state bound to them", async (_who, as) => {
      const res = await call(as, "POST", `/withings/links/${people.ally!.memberId}/connect`, { backfillDays: 90 });
      expect(res.status, JSON.stringify(res.json)).toBe(200);

      const url = new URL(res.json.authorizeUrl);
      expect(url.origin + url.pathname).toBe("https://account.withings.com/oauth2_user/authorize2");
      expect(url.searchParams.get("redirect_uri")).toBe("https://app.test.example/api/integrations/withings/callback");
      expect(url.searchParams.get("scope")).toBe("user.metrics");

      const [, prefix, state, payload] = vi.mocked(setOAuthState).mock.calls[0] as unknown as [string, string, string, Record<string, unknown>];
      expect(prefix).toBe(WITHINGS_OAUTH_PREFIX);
      expect(url.searchParams.get("state")).toBe(state);
      expect(payload).toEqual({
        userId: people[as]!.userId,
        householdId,
        memberId: people.ally!.memberId,
        backfillDays: 90,
      });
    });

    it.each([
      ["someone who can only read", "reader"],
      ["someone with no access", "stranger"],
      ["a member of another household", "outsider"],
    ])("refuses %s, before saying anything about server config", async (_who, as) => {
      const res = await call(as, "POST", `/withings/links/${people.ally!.memberId}/connect`, {});
      expect(res.status).toBe(as === "outsider" ? 404 : 403);
      expect(setOAuthState).not.toHaveBeenCalled();
    });

    it("clamps the backfill window", async () => {
      await call("mom", "POST", `/withings/links/${people.ally!.memberId}/connect`, { backfillDays: 999_999 });
      await call("mom", "POST", `/withings/links/${people.ally!.memberId}/connect`, { backfillDays: -5 });
      await call("mom", "POST", `/withings/links/${people.ally!.memberId}/connect`, { backfillDays: "lots" });
      const days = vi.mocked(setOAuthState).mock.calls.map((c) => (c[3] as { backfillDays: number }).backfillDays);
      expect(days).toEqual([3650, 1, 365]);
    });

    it("will not start a second link for a member", async () => {
      await makeLink();
      const res = await call("mom", "POST", `/withings/links/${people.ally!.memberId}/connect`, {});
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("already_linked");
    });
  });

  describe("the OAuth callback", () => {
    const state = {
      get: () => ({ userId: people.mom!.userId, householdId, memberId: people.ally!.memberId, backfillDays: 30 }),
    };
    const tokens = { userId: "9001", accessToken: "access-9", refreshToken: "refresh-9", expiresInSec: 10800, scope: "user.metrics" };

    it("creates the link with encrypted tokens, subscribes to the webhook, and sends the browser back", async () => {
      vi.mocked(consumeOAuthState).mockResolvedValueOnce(state.get());
      vi.mocked(withingsExchangeCode).mockResolvedValueOnce(tokens);

      const res = await call("mom", "GET", "/integrations/callback?code=abc&state=xyz");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://app.test.example/health?withings=connected");

      const [link] = await withHouseholdContext(baseDb, householdId, (tx) => tx.select().from(healthWithingsLinks));
      expect(link).toMatchObject({ memberId: people.ally!.memberId, withingsUserId: "9001", status: "active", linkedByUserId: people.mom!.userId });
      expect(link!.accessTokenEncrypted.startsWith("enc:v1:")).toBe(true);
      expect(decryptSensitive(link!.accessTokenEncrypted, KEY)).toBe("access-9");
      expect(decryptSensitive(link!.refreshTokenEncrypted, KEY)).toBe("refresh-9");
      // History window from the connect step, and a pull queued for the worker's next tick.
      expect(link!.syncRequestedAt).not.toBeNull();
      const days = (link!.syncRequestedAt!.getTime() - link!.backfillFrom.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);

      expect(withingsExchangeCode).toHaveBeenCalledWith(expect.anything(), "abc", "https://app.test.example/api/integrations/withings/callback");
      const [accessToken, callback] = vi.mocked(withingsSubscribe).mock.calls[0] as unknown as [string, string];
      expect(accessToken).toBe("access-9");
      expect(callback.startsWith("https://app.test.example/api/integrations/withings/webhook?t=")).toBe(true);
      expect(verifyWithingsWebhookToken(new URL(callback).searchParams.get("t")!, KEY)).toEqual({
        v: 1,
        kind: "withings-webhook",
        householdId,
        linkId: link!.id,
      });
    });

    it("still links when the webhook subscription fails, leaving the safety-net pull to do the work", async () => {
      vi.mocked(consumeOAuthState).mockResolvedValueOnce(state.get());
      vi.mocked(withingsExchangeCode).mockResolvedValueOnce(tokens);
      vi.mocked(withingsSubscribe).mockRejectedValueOnce(new Error("withings down"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await call("mom", "GET", "/integrations/callback?code=abc&state=xyz");
      expect(res.headers.get("location")).toContain("withings=connected");
      expect(await withHouseholdContext(baseDb, householdId, (tx) => tx.select().from(healthWithingsLinks))).toHaveLength(1);
      spy.mockRestore();
    });

    it("refuses a state that belongs to someone else, so a finished link can't be planted on another member", async () => {
      // Mom started it; the browser finishing it is signed in as the sitter.
      vi.mocked(consumeOAuthState).mockResolvedValueOnce(state.get());
      const res = await call("sitter", "GET", "/integrations/callback?code=abc&state=xyz");
      expect(res.headers.get("location")).toContain("withings=error");
      expect(withingsExchangeCode).not.toHaveBeenCalled();
      expect(await withHouseholdContext(baseDb, householdId, (tx) => tx.select().from(healthWithingsLinks))).toHaveLength(0);
    });

    it("refuses when the starter has lost write access since", async () => {
      vi.mocked(consumeOAuthState).mockResolvedValueOnce({ ...state.get(), userId: people.reader!.userId });
      const res = await call("reader", "GET", "/integrations/callback?code=abc&state=xyz");
      expect(res.headers.get("location")).toContain("withings=forbidden");
      expect(withingsExchangeCode).not.toHaveBeenCalled();
    });

    it.each([
      ["an unknown or used state", "/integrations/callback?code=abc&state=nope", "expired"],
      ["a missing code", "/integrations/callback?state=xyz", "error"],
      ["the user declining", "/integrations/callback?error=access_denied&state=xyz", "denied"],
    ])("sends %s back with a reason, and links nothing", async (_what, path, reason) => {
      const res = await call("mom", "GET", path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`https://app.test.example/health?withings=${reason}`);
      expect(withingsExchangeCode).not.toHaveBeenCalled();
    });

    it("reports a second link for the same member instead of failing", async () => {
      await makeLink();
      vi.mocked(consumeOAuthState).mockResolvedValueOnce(state.get());
      vi.mocked(withingsExchangeCode).mockResolvedValueOnce(tokens);
      const res = await call("mom", "GET", "/integrations/callback?code=abc&state=xyz");
      expect(res.headers.get("location")).toContain("withings=already_linked");
    });
  });

  describe("the webhook", () => {
    const hook = (link: { id: string; householdId: string }, form: Record<string, string> = { userid: "9001", appli: "4" }, secret = KEY) =>
      // No x-as: Withings has no session.
      call("", "POST", webhookUrl(link, secret), undefined, { form });

    it("flags the link for a pull and answers 200", async () => {
      const link = await makeLink();
      const res = await hook(link);
      expect(res.status).toBe(200);
      expect((await reload(link.id))!.syncRequestedAt).not.toBeNull();
    });

    it("answers a HEAD or GET check of the URL, which Withings does when subscribing", async () => {
      const link = await makeLink();
      expect((await call("", "GET", webhookUrl(link))).status).toBe(200);
      expect((await call("", "HEAD", webhookUrl(link))).status).toBe(200);
    });

    it("rejects a missing, forged or wrongly signed token and flags nothing", async () => {
      const link = await makeLink();
      expect((await call("", "POST", "/integrations/webhook", undefined, { form: { userid: "9001" } })).status).toBe(401);
      expect((await call("", "POST", "/integrations/webhook?t=garbage.garbage", undefined, { form: { userid: "9001" } })).status).toBe(401);
      expect((await hook(link, undefined, "some-other-secret-key-32-chars!!!!")).status).toBe(401);
      expect((await reload(link.id))!.syncRequestedAt).toBeNull();
    });

    it("ignores a call for a different Withings user than the link's", async () => {
      const link = await makeLink();
      const res = await hook(link, { userid: "1234", appli: "4" });
      expect(res.status).toBe(200);
      expect((await reload(link.id))!.syncRequestedAt).toBeNull();
    });

    it("ignores a link that is revoked, or a token naming a household the link is not in", async () => {
      const revoked = await makeLink({ status: "revoked" });
      expect((await hook(revoked)).status).toBe(200);
      expect((await reload(revoked.id))!.syncRequestedAt).toBeNull();

      await withHouseholdContext(baseDb, householdId, (tx) => tx.delete(healthWithingsLinks));
      const link = await makeLink();
      const otherHousehold = people.outsider!.householdId;
      // Validly signed, but pairs this link with the wrong tenant: RLS hides it, so nothing is flagged.
      expect((await hook({ id: link.id, householdId: otherHousehold })).status).toBe(200);
      expect((await reload(link.id))!.syncRequestedAt).toBeNull();
    });

    it("answers 200 for a link that has since been removed", async () => {
      const link = await makeLink();
      await withHouseholdContext(baseDb, householdId, (tx) => tx.delete(healthWithingsLinks).where(eq(healthWithingsLinks.id, link.id)));
      expect((await hook(link)).status).toBe(200);
    });
  });

  describe("managing a link", () => {
    it("lists links to people who can read the member, without any token", async () => {
      await makeLink();
      const seen = await call("reader", "GET", "/withings");
      expect(seen.status).toBe(200);
      expect(seen.json.enabled).toBe(true);
      expect(seen.json.links).toHaveLength(1);
      expect(seen.json.links[0]).toMatchObject({ memberId: people.ally!.memberId, status: "active", backfillDone: false });
      expect(JSON.stringify(seen.json)).not.toMatch(/access-1|refresh-1|enc:v1|withingsUserId|9001/);

      expect((await call("stranger", "GET", "/withings")).json.links).toHaveLength(0);
      expect((await call("outsider", "GET", "/withings")).json.links).toHaveLength(0);
    });

    it("syncs now for writers only, and brings an errored link back", async () => {
      const link = await makeLink({ status: "error", lastError: "transient", attempts: 8, nextAttemptAt: new Date(Date.now() + 3600_000) });
      expect((await call("reader", "POST", `/withings/links/${people.ally!.memberId}/sync`)).status).toBe(403);
      expect((await call("stranger", "POST", `/withings/links/${people.ally!.memberId}/sync`)).status).toBe(403);

      const res = await call("sitter", "POST", `/withings/links/${people.ally!.memberId}/sync`);
      expect(res.status).toBe(200);
      const after = (await reload(link.id))!;
      expect(after).toMatchObject({ status: "active", lastError: null, attempts: 0, nextAttemptAt: null });
      expect(after.syncRequestedAt).not.toBeNull();
    });

    it("cannot revive a revoked link: it has to be linked again", async () => {
      await makeLink({ status: "revoked" });
      expect((await call("mom", "POST", `/withings/links/${people.ally!.memberId}/sync`)).status).toBe(404);
      expect((await call("mom", "POST", `/withings/links/${people.ally!.memberId}/backfill`, { days: 30 })).status).toBe(404);
    });

    it("restarts the backfill over a new window and clears the watermark", async () => {
      const link = await makeLink({ backfillDoneAt: new Date(), lastUpdate: 1_790_000_000 });
      const before = Date.now();
      const res = await call("mom", "POST", `/withings/links/${people.ally!.memberId}/backfill`, { days: 30 });
      expect(res.status).toBe(200);
      expect(res.json.link.backfillDone).toBe(false);

      const after = (await reload(link.id))!;
      expect(after.backfillDoneAt).toBeNull();
      expect(after.lastUpdate).toBeNull();
      expect(after.syncRequestedAt).not.toBeNull();
      expect(Math.round((before - after.backfillFrom.getTime()) / 86_400_000)).toBe(30);
      expect((await call("reader", "POST", `/withings/links/${people.ally!.memberId}/backfill`, { days: 30 })).status).toBe(403);
    });

    it("unlinks, unsubscribes from the webhook, and keeps the readings already imported", async () => {
      const link = await makeLink();
      const [event] = await withHouseholdContext(baseDb, householdId, (tx) =>
        tx
          .insert(healthEvents)
          .values({ householdId, memberId: people.ally!.memberId, type: "vitals", title: "kept", startedAt: new Date() })
          .returning({ id: healthEvents.id }),
      );

      expect((await call("reader", "DELETE", `/withings/links/${people.ally!.memberId}`)).status).toBe(403);
      expect(await reload(link.id)).toBeDefined();

      const res = await call("mom", "DELETE", `/withings/links/${people.ally!.memberId}`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ok: true, unsubscribedRemotely: true });
      expect(await reload(link.id)).toBeUndefined();
      expect(vi.mocked(withingsUnsubscribe).mock.calls[0]![0]).toBe("access-1");

      const kept = await withHouseholdContext(baseDb, householdId, (tx) => tx.select().from(healthEvents).where(eq(healthEvents.id, event!.id)));
      expect(kept).toHaveLength(1);
    });

    it("unlinks even when Withings cannot be reached, and says so", async () => {
      const link = await makeLink();
      vi.mocked(withingsUnsubscribe).mockRejectedValueOnce(new Error("down"));
      const res = await call("mom", "DELETE", `/withings/links/${people.ally!.memberId}`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ok: true, unsubscribedRemotely: false });
      expect(await reload(link.id)).toBeUndefined();
    });

    it("cannot reach into another household's link", async () => {
      const link = await makeLink();
      // The outsider owns their own household, but Ally is not in it.
      for (const [method, path] of [
        ["DELETE", ""],
        ["POST", "/sync"],
        ["POST", "/backfill"],
      ] as const) {
        expect((await call("outsider", method, `/withings/links/${people.ally!.memberId}${path}`, { days: 30 })).status).toBe(403);
      }
      const untouched = (await reload(link.id))!;
      expect(untouched).toMatchObject({ status: "active", syncRequestedAt: null, backfillDoneAt: null });
    });
  });

  describe("on a deployment without Withings credentials", () => {
    it("reports the feature off and refuses to start a link", async () => {
      const bare = { ...env, WITHINGS_CLIENT_ID: undefined, WITHINGS_CLIENT_SECRET: undefined } as unknown as Env;
      const scoped = createScopedDb(baseDb);
      const off = new Hono<{ Variables: AppVariables }>();
      off.use("*", async (c, next) => {
        const who = people.mom!;
        c.set("userId", who.userId);
        c.set("auth", { userId: who.userId, householdId: who.householdId, memberId: who.memberId, email: null, username: null, name: null, role: who.role });
        return next();
      });
      off.use("*", createTenantMiddleware(scoped, bare));
      off.route("/withings", healthWithingsRoutes(scoped, bare));

      const list = await off.request("/withings");
      expect(await list.json()).toEqual({ enabled: false, links: [] });
      const connect = await off.request(`/withings/links/${people.ally!.memberId}/connect`, { method: "POST" });
      expect(connect.status).toBe(404);
    });
  });
});
