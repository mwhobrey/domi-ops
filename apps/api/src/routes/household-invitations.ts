import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { isSmtpConfigured, type Env } from "@domi-ops/config";
import { sendHouseholdInvitationEmail } from "@domi-ops/auth";
import { householdInvitations, householdMembers, households, users, withSystemContext, type Database } from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { activeInvitationWhere, INVITATION_COOKIE, invitationTokenHash, lookupHouseholdInvitation } from "../lib/household-invitations.js";

export function householdInvitationRoutes(db: Database, env: Env, sendEmail = sendHouseholdInvitationEmail) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); c.header("Referrer-Policy", "no-referrer"); await next(); });
  const canManage = (role: string | undefined) => role === "owner" || role === "admin";

  app.get("/core/household/invitations", async (c) => {
    const auth = c.get("auth");
    if (!auth || !canManage(auth.role)) return c.json({ error: "forbidden" }, 403);
    const invitations = await db.select({ id: householdInvitations.id, email: householdInvitations.email, role: householdInvitations.role, expiresAt: householdInvitations.expiresAt, revokedAt: householdInvitations.revokedAt, acceptedAt: householdInvitations.acceptedAt }).from(householdInvitations).where(eq(householdInvitations.householdId, auth.householdId)).orderBy(desc(householdInvitations.createdAt)).limit(100);
    return c.json({ invitations });
  });
  app.post("/core/household/invitations", async (c) => {
    const auth = c.get("auth");
    if (!auth || !canManage(auth.role)) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ email?: string; role?: string; delivery?: string }>();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body.role ?? "member";
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid_email" }, 400);
    if (!["admin", "member", "guest"].includes(role) || (role === "admin" && auth.role !== "owner")) return c.json({ error: "invalid_role" }, 400);
    if (body.delivery !== "link" && !isSmtpConfigured(env)) return c.json({ error: "smtp_not_configured", message: "Email delivery is unavailable. Choose a shareable invitation link." }, 503);
    const token = randomBytes(32).toString("base64url");
    await db.select({ id: households.id }).from(households).where(eq(households.id, auth.householdId)).for("update");
    const [actor] = await db.select({ role: householdMembers.role }).from(householdMembers).where(and(eq(householdMembers.householdId, auth.householdId), eq(householdMembers.userId, auth.userId), isNull(householdMembers.accessRevokedAt)));
    if (!canManage(actor?.role) || (role === "admin" && actor?.role !== "owner")) return c.json({ error: "forbidden" }, 403);
    const [household] = await db.select({ name: households.name }).from(households).where(eq(households.id, auth.householdId));
    // Reissuing revokes older outstanding invitations to this address in this home.
    await db.update(householdInvitations).set({ revokedAt: new Date() }).where(and(eq(householdInvitations.householdId, auth.householdId), eq(householdInvitations.email, email), isNull(householdInvitations.acceptedAt), isNull(householdInvitations.revokedAt)));
    const [invitation] = await db.insert(householdInvitations).values({ householdId: auth.householdId, email, role: role as "admin" | "member" | "guest", tokenHash: invitationTokenHash(token), createdByMemberId: auth.memberId, expiresAt: new Date(Date.now() + 7 * 86400000) }).returning({ id: householdInvitations.id });
    const url = new URL("/join", env.PUBLIC_APP_URL); url.searchParams.set("token", token);
    if (body.delivery !== "link") {
      try { await sendEmail(env, { to: email, url: url.toString(), householdName: household.name }); }
      catch { await db.update(householdInvitations).set({ revokedAt: new Date() }).where(eq(householdInvitations.id, invitation.id)); return c.json({ error: "invitation_delivery_failed", message: "Email delivery could not be confirmed. Create a new link or try again." }, 503); }
    }
    return c.json({ id: invitation.id, joinUrl: body.delivery === "link" ? url.toString() : undefined, delivered: body.delivery !== "link" }, 201);
  });
  app.delete("/core/household/invitations/:id", async (c) => {
    const auth = c.get("auth");
    if (!auth || !canManage(auth.role)) return c.json({ error: "forbidden" }, 403);
    await db.update(householdInvitations).set({ revokedAt: new Date() }).where(and(eq(householdInvitations.id, c.req.param("id")), eq(householdInvitations.householdId, auth.householdId), isNull(householdInvitations.acceptedAt)));
    return c.json({ ok: true });
  });
  app.post("/invitations/prepare", async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const token = body.token ?? getCookie(c, INVITATION_COOKIE) ?? "";
    const found = await lookupHouseholdInvitation(db, token);
    if (!found) return c.json({ error: "invitation_invalid_or_expired" }, 404);
    setCookie(c, INVITATION_COOKIE, token, { httpOnly: true, secure: new URL(env.PUBLIC_APP_URL).protocol === "https:", sameSite: "Lax", path: "/", maxAge: 7 * 86400 });
    return c.json({ householdName: found.householdName, email: found.invitation.email, role: found.invitation.role, expiresAt: found.invitation.expiresAt, signedIn: Boolean(c.get("userId")) });
  });
  app.post("/invitations/accept", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "signin_required" }, 401);
    const body = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
    const token = body.token ?? getCookie(c, INVITATION_COOKIE) ?? "";
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return c.json({ error: "invitation_invalid_or_expired" }, 404);
    const result = await withSystemContext(db, async (tx) => {
      // Serialize membership attachment with checkout provisioning for the same user.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:owner:${userId}`}, 0))`);
      const [candidate] = await tx.select().from(householdInvitations).where(activeInvitationWhere(token));
      if (!candidate) return "invitation_invalid_or_expired";
      await tx.select({ id: households.id }).from(households).where(eq(households.id, candidate.householdId)).for("update");
      const [invitation] = await tx.select().from(householdInvitations).where(activeInvitationWhere(token)).for("update");
      if (!invitation) return "invitation_invalid_or_expired";
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user?.emailVerified) return "verify_email_required";
      if (user.email?.trim().toLowerCase() !== invitation.email) return "invitation_email_mismatch";
      const memberships = await tx.select().from(householdMembers).where(eq(householdMembers.userId, userId));
      if (memberships.some((m) => !m.accessRevokedAt && m.householdId !== invitation.householdId)) return "already_in_another_household";
      const previous = memberships.find((m) => m.householdId === invitation.householdId);
      if (previous?.accessRevokedAt) await tx.update(householdMembers).set({ accessRevokedAt: null, role: invitation.role }).where(eq(householdMembers.id, previous.id));
      if (!previous) await tx.insert(householdMembers).values({ householdId: invitation.householdId, userId, role: invitation.role, name: user.displayName });
      await tx.update(householdInvitations).set({ acceptedAt: new Date(), acceptedByUserId: userId }).where(eq(householdInvitations.id, invitation.id));
      return "ok";
    });
    if (result !== "ok") return c.json({ error: result }, result === "invitation_invalid_or_expired" ? 404 : 409);
    deleteCookie(c, INVITATION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  return app;
}
