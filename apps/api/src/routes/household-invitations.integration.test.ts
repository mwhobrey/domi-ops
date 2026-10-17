import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { resolveAuthContext, ensureHouseholdMembership } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import { createDb, createScopedDb, closeDb, householdInvitations, householdMembers, households, householdSubscriptions, healthMedications, userNotifications, users, withHouseholdContext, withSystemContext, withUserLookupContext, type Database } from "@domi-ops/db";
import { persistUserNotifications } from "@domi-ops/calendar-sync";
import { householdInvitationRoutes } from "./household-invitations.js";
import { householdRoutes } from "./household.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { createSubscriptionMiddleware } from "../middleware/subscription.js";
import type { AppVariables } from "../middleware/auth.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;
type Invite = { id: string; joinUrl: string; delivered: boolean };
maybeDescribe("hosted household invitation and access lifecycle", () => {
  let db: Database;
  let app: Hono<{ Variables: AppVariables }>;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, { userId: string; memberId?: string; email: string }> = {};
  const sent: { to: string; url: string }[] = [];
  const env = { NODE_ENV: "test", AUTH_REQUIRED: true, DEPLOYMENT_MODE: "shared", MODULES_ENABLED: ["core", "school", "calendar_sync", "drive", "health", "goals"], PUBLIC_APP_URL: "https://app.test", SMTP_HOST: "fixture", SMTP_FROM: "test@example.test" } as Env;
  const request = (as: string, path: string, method = "GET", body?: unknown) => app.request(path, { method, headers: { "x-as": as, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const create = async (who: string, as = "owner", role = "member") => {
    const result = await request(as, "/api/core/household/invitations", "POST", { email: people[who].email, delivery: "link", role });
    expect(result.status).toBe(201); return await result.json() as Invite;
  };
  const token = (invite: Invite) => new URL(invite.joinUrl).searchParams.get("token")!;

  beforeAll(async () => {
    db = createDb(TEST_URL!);
    await withSystemContext(db, async (tx) => {
      for (const group of [["owner", "admin"], ["stranger"]]) {
        const [h] = await tx.insert(households).values({ name: `invites-${randomUUID()}`, tier: "hosted_starter", modulesEnabled: JSON.stringify(env.MODULES_ENABLED) }).returning(); householdIds.push(h.id);
        await tx.insert(householdSubscriptions).values({ householdId: h.id, modulesEntitled: JSON.stringify(env.MODULES_ENABLED), status: "active", currentPeriodEnd: new Date(Date.now() + 86400000) });
        for (const who of group) {
          const [u] = await tx.insert(users).values({ email: `invites-${randomUUID()}@example.test`, emailVerified: true }).returning(); userIds.push(u.id);
          const [m] = await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: who === "admin" ? "admin" : "owner" }).returning(); people[who] = { userId: u.id, memberId: m.id, email: u.email! };
        }
      }
      for (const who of ["adult", "unverified", "revoked", "expired", "second"]) {
        const [u] = await tx.insert(users).values({ email: `invites-${randomUUID()}@example.test`, emailVerified: who !== "unverified" }).returning(); userIds.push(u.id); people[who] = { userId: u.id, email: u.email! };
      }
    });
    const scoped = createScopedDb(db);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      const p = people[c.req.header("x-as") ?? ""];
      c.set("userId", p?.userId ?? null);
      c.set("auth", p ? await withUserLookupContext(db, p.userId, (tx) => resolveAuthContext(tx, p.userId)) : null);
      await next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.use("/api/*", createSubscriptionMiddleware(scoped, env));
    app.route("/api", householdInvitationRoutes(scoped, env, async (_env, input) => { sent.push(input); }));
    app.route("/api/core", householdRoutes(scoped, env));
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(db);
  });

  it("authorizes roles and stores only a hash of a private, expiring invitation token", async () => {
    expect((await request("", "/api/core/household/invitations", "POST", {})).status).toBe(403);
    expect((await request("admin", "/api/core/household/invitations", "POST", { email: people.adult.email, role: "admin", delivery: "link" })).status).toBe(400);
    const invite = await create("adult");
    const [row] = await withHouseholdContext(db, householdIds[0], (tx) => tx.select().from(householdInvitations).where(eq(householdInvitations.id, invite.id)));
    expect(row.tokenHash).not.toBe(token(invite)); expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await request("adult", "/api/invitations/prepare", "POST", { token: token(invite) })).headers.get("set-cookie")).toContain("HttpOnly");
    expect((await request("stranger", "/api/invitations/accept", "POST", { token: token(invite) })).status).toBe(409);
    expect((await request("adult", "/api/invitations/accept", "POST", { token: token(invite) })).status).toBe(200);
    expect((await request("adult", "/api/invitations/accept", "POST", { token: token(invite) })).status).toBe(404);
    const context = await withUserLookupContext(db, people.adult.userId, (tx) => resolveAuthContext(tx, people.adult.userId));
    expect(context?.householdId).toBe(householdIds[0]); expect(context?.role).toBe("member"); people.adult.memberId = context!.memberId;
    expect(await withSystemContext(db, (tx) => tx.select().from(householdSubscriptions).where(inArray(householdSubscriptions.householdId, householdIds)))).toHaveLength(2);
  });
  it("requires verified matching email and rejects expired, revoked and moved-account invitations", async () => {
    const unverified = await create("unverified");
    expect((await request("unverified", "/api/invitations/accept", "POST", { token: token(unverified) })).status).toBe(409);
    const revoked = await create("revoked");
    await request("owner", `/api/core/household/invitations/${revoked.id}`, "DELETE");
    expect((await request("revoked", "/api/invitations/accept", "POST", { token: token(revoked) })).status).toBe(404);
    const expired = await create("expired");
    await withHouseholdContext(db, householdIds[0], (tx) => tx.update(householdInvitations).set({ expiresAt: new Date(0) }).where(eq(householdInvitations.id, expired.id)));
    expect((await request("expired", "/api/invitations/accept", "POST", { token: token(expired) })).status).toBe(404);
    const other = await create("stranger");
    expect((await request("stranger", "/api/invitations/accept", "POST", { token: token(other) })).status).toBe(409);
  });
  it("sends the invitation only to the bound email through the configured sender", async () => {
    expect((await request("owner", "/api/core/household/invitations", "POST", { email: people.second.email })).status).toBe(201);
    expect(sent.at(-1)?.to).toBe(people.second.email);
    expect(sent.at(-1)?.url).toMatch(/^https:\/\/app.test\/join\?token=/);
  });
  it("removes access without deleting history, denies notification delivery and requires a new invitation to rejoin", async () => {
    const [medication] = await withHouseholdContext(db, householdIds[0], (tx) => tx.insert(healthMedications).values({ householdId: householdIds[0], memberId: people.adult.memberId!, name: "synthetic-history" }).returning());
    expect((await request("admin", `/api/core/household/members/${people.owner.memberId}`, "DELETE", { confirm: "REMOVE" })).status).toBe(403);
    expect((await request("owner", `/api/core/household/members/${people.adult.memberId}`, "DELETE", { confirm: "REMOVE" })).status).toBe(200);
    expect(await withUserLookupContext(db, people.adult.userId, (tx) => resolveAuthContext(tx, people.adult.userId))).toBeNull();
    await withUserLookupContext(db, people.adult.userId, (tx) => ensureHouseholdMembership(tx, env, people.adult.userId));
    expect(await withUserLookupContext(db, people.adult.userId, (tx) => resolveAuthContext(tx, people.adult.userId))).toBeNull();
    await withHouseholdContext(db, householdIds[0], async (tx) => {
      expect(await tx.select().from(healthMedications).where(eq(healthMedications.id, medication.id))).toHaveLength(1);
      await persistUserNotifications(tx, { householdId: householdIds[0], userIds: [people.adult.userId], title: "private", body: "private", url: "/health" });
      expect(await tx.select().from(userNotifications).where(eq(userNotifications.userId, people.adult.userId))).toHaveLength(0);
    });
    const reinvite = await create("adult");
    expect((await request("adult", "/api/invitations/accept", "POST", { token: token(reinvite) })).status).toBe(200);
    expect((await withUserLookupContext(db, people.adult.userId, (tx) => resolveAuthContext(tx, people.adult.userId)))?.memberId).toBe(people.adult.memberId);
  });
  it("serializes owner demotion so the last owner survives", async () => {
    await request("owner", `/api/core/household/members/${people.admin.memberId}/role`, "PATCH", { role: "owner" });
    const results = await Promise.all([
      request("owner", `/api/core/household/members/${people.owner.memberId}/role`, "PATCH", { role: "member" }),
      request("admin", `/api/core/household/members/${people.admin.memberId}/role`, "PATCH", { role: "member" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const owners = await withHouseholdContext(db, householdIds[0], (tx) => tx.select().from(householdMembers).where(and(eq(householdMembers.householdId, householdIds[0]), eq(householdMembers.role, "owner"))));
    expect(owners).toHaveLength(1);
  });
});
