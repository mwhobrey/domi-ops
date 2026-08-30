import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { isModuleEnabled } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { homeStatus, householdMembers } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import {
  normalizePresence,
  normalizeStatusMessage,
  serializeHomeStatus,
} from "../lib/home-status.js";
import { memberAvatarUrl } from "../lib/avatar-url.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function dashboardRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/dashboard", async (c) => {
    if (!isModuleEnabled(env, "core")) {
      return c.json({ error: "core_disabled" }, 403);
    }
    const auth = c.get("auth")!;
    const statuses = await db
      .select()
      .from(homeStatus)
      .where(eq(homeStatus.householdId, auth.householdId));
    const members = await db
      .select({ id: householdMembers.id, avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, auth.householdId));
    const avatarByMember = new Map(members.map((m) => [m.id, m.avatarKey]));

    return c.json({
      whosHome: statuses.map((s) => ({
        id: s.id,
        memberId: s.memberId,
        name: s.name,
        avatarUrl: s.memberId
          ? memberAvatarUrl(s.memberId, avatarByMember.get(s.memberId))
          : null,
        ...serializeHomeStatus({
          presence: normalizePresence(s.presence),
          statusMessage: s.statusMessage,
        }),
      })),
    });
  });

  app.patch("/dashboard/home-status/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      presence?: string;
      statusMessage?: string | null;
      /** @deprecated use presence + statusMessage */
      status?: string;
    }>();

    const [existing] = await db
      .select({
        presence: homeStatus.presence,
        statusMessage: homeStatus.statusMessage,
      })
      .from(homeStatus)
      .where(and(eq(homeStatus.id, id), eq(homeStatus.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    let presence = normalizePresence(existing.presence);
    let statusMessage = normalizeStatusMessage(existing.statusMessage);

    if (body.status !== undefined && body.presence === undefined && body.statusMessage === undefined) {
      const legacy = (body.status ?? "").trim();
      if (legacy === "Home" || legacy === "Away") {
        presence = legacy;
        statusMessage = null;
      } else {
        statusMessage = normalizeStatusMessage(legacy);
      }
    } else {
      if (body.presence !== undefined) presence = normalizePresence(body.presence);
      if (body.statusMessage !== undefined) statusMessage = normalizeStatusMessage(body.statusMessage);
    }

    await db
      .update(homeStatus)
      .set({ presence, statusMessage, updatedAt: new Date() })
      .where(and(eq(homeStatus.id, id), eq(homeStatus.householdId, auth.householdId)));
    return c.json({ ok: true, ...serializeHomeStatus({ presence, statusMessage }) });
  });

  return app;
}
