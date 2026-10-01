import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { myallyfileApiBase } from "@domi-ops/config";
import {
  MyallyfileError,
  decryptMyallyfileSecret,
  encryptMyallyfileSecret,
  markMyallyfileSyncNeeded,
  myallyfileExchangeLinkCode,
  myallyfileRevokeLink,
} from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import { healthMyallyfileLinks } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { decryptHealthFieldOrPassthrough, encryptHealthField } from "../lib/health-crypto.js";
import { hasHealthSegmentAccess } from "../lib/health-access.js";

/** Crockford base32 without I, L, O, U (MyAllyFile link codes: XXXX-XXXX). */
const LINK_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export function normalizeMyallyfileLinkCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();
  return LINK_CODE_RE.test(cleaned) ? cleaned : null;
}

type LinkRow = typeof healthMyallyfileLinks.$inferSelect;

/** Never includes the token. */
function serializeLink(row: LinkRow, env: Env) {
  return {
    memberId: row.memberId,
    status: row.status,
    profileName: decryptHealthFieldOrPassthrough(row.profileName, env),
    includePrn: row.includePrn,
    includeOtc: row.includeOtc,
    includePaused: row.includePaused,
    linkedAt: row.linkedAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    syncPending: row.syncRequestedAt != null,
  };
}

function instanceLabel(env: Env): string {
  try {
    return new URL(env.PUBLIC_APP_URL).host;
  } catch {
    return "Domi Ops";
  }
}

export function healthMyallyfileRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const enabled = () => myallyfileApiBase(env) != null;

  /** Links the caller may see (medications read), plus which visible meds are opted in. */
  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ enabled: false, links: [] });

    const rows = await db
      .select()
      .from(healthMyallyfileLinks)
      .where(eq(healthMyallyfileLinks.householdId, auth.householdId));
    const links: ReturnType<typeof serializeLink>[] = [];
    for (const row of rows) {
      if (await hasHealthSegmentAccess(db, auth, row.memberId, "medications", "read")) {
        links.push(serializeLink(row, env));
      }
    }

    return c.json({ enabled: true, links });
  });

  app.post("/links", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    if (!env.ENCRYPTION_KEY) return c.json({ error: "encryption_key_required" }, 503);

    const body = await c.req
      .json<{
        memberId?: string;
        code?: string;
        includePrn?: boolean;
        includeOtc?: boolean;
        includePaused?: boolean;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    const code = normalizeMyallyfileLinkCode(body.code);
    if (!memberId) return c.json({ error: "invalid_body" }, 400);
    if (!code) return c.json({ error: "invalid_code" }, 400);

    if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [existing] = await db
      .select({ id: healthMyallyfileLinks.id })
      .from(healthMyallyfileLinks)
      .where(eq(healthMyallyfileLinks.memberId, memberId))
      .limit(1);
    if (existing) return c.json({ error: "already_linked" }, 409);

    let linked;
    try {
      linked = await myallyfileExchangeLinkCode(env, code, instanceLabel(env));
    } catch (e) {
      if (e instanceof MyallyfileError) {
        if (e.code === "code_invalid") return c.json({ error: "code_invalid" }, 422);
        if (e.code === "entitlement_required") return c.json({ error: "entitlement_required" }, 402);
        if (e.code === "profile_not_found") return c.json({ error: "profile_not_found" }, 404);
        return c.json({ error: "myallyfile_unavailable" }, 502);
      }
      throw e;
    }

    const [row] = await db
      .insert(healthMyallyfileLinks)
      .values({
        householdId: auth.householdId,
        memberId,
        myallyfileProfileId: linked.profileId,
        profileName: encryptHealthField(linked.profileName, env),
        instanceLabel: instanceLabel(env),
        tokenEncrypted: encryptMyallyfileSecret(linked.token, env),
        // As-needed and OTC meds matter to a responder, so they're on unless switched off.
        includePrn: body.includePrn !== false,
        includeOtc: body.includeOtc !== false,
        includePaused: body.includePaused !== false,
        linkedByUserId: auth.userId,
        // First push goes out on the next scan, even if no meds are opted in yet (clears any
        // stale synced list on the MyAllyFile side).
        syncRequestedAt: new Date(),
      })
      .returning();
    return c.json({ link: serializeLink(row, env) }, 201);
  });

  app.patch("/links/:memberId", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    const memberId = c.req.param("memberId");
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req
      .json<{ includePrn?: boolean; includeOtc?: boolean; includePaused?: boolean }>()
      .catch(() => ({}) as Record<string, never>);
    const patch: Partial<typeof healthMyallyfileLinks.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.includePrn === "boolean") patch.includePrn = body.includePrn;
    if (typeof body.includeOtc === "boolean") patch.includeOtc = body.includeOtc;
    if (typeof body.includePaused === "boolean") patch.includePaused = body.includePaused;

    const [row] = await db
      .update(healthMyallyfileLinks)
      .set(patch)
      .where(
        and(
          eq(healthMyallyfileLinks.memberId, memberId),
          eq(healthMyallyfileLinks.householdId, auth.householdId),
        ),
      )
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    await markMyallyfileSyncNeeded(db, memberId);
    return c.json({ link: serializeLink(row, env) });
  });

  /** "Sync now": also the way out of entitlement_required / error once the cause is fixed. */
  app.post("/links/:memberId/sync", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    const memberId = c.req.param("memberId");
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .update(healthMyallyfileLinks)
      .set({
        status: "active",
        lastError: null,
        lastSnapshotHash: null,
        attempts: 0,
        nextAttemptAt: null,
        // Backdated so the scan picks it up immediately instead of waiting out the debounce.
        syncRequestedAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(healthMyallyfileLinks.memberId, memberId),
          eq(healthMyallyfileLinks.householdId, auth.householdId),
          // A revoked token can't be revived by retrying; the user must re-link.
          inArray(healthMyallyfileLinks.status, ["active", "entitlement_required", "error"]),
        ),
      )
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ link: serializeLink(row, env) });
  });

  app.delete("/links/:memberId", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    const memberId = c.req.param("memberId");
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .select()
      .from(healthMyallyfileLinks)
      .where(
        and(
          eq(healthMyallyfileLinks.memberId, memberId),
          eq(healthMyallyfileLinks.householdId, auth.householdId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);

    // Best effort: if MyAllyFile is down or already revoked, we still drop our side. The user can
    // revoke from MyAllyFile Connected apps in that case.
    let revoked = true;
    try {
      await myallyfileRevokeLink(env, decryptMyallyfileSecret(row.tokenEncrypted, env));
    } catch {
      revoked = false;
    }
    await db.delete(healthMyallyfileLinks).where(eq(healthMyallyfileLinks.id, row.id));
    return c.json({ ok: true, revokedRemotely: revoked });
  });

  return app;
}
