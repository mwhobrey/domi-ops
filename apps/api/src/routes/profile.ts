import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { homeStatus, householdMembers, pushSubscriptions, users } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { memberShownLabel } from "@domi-ops/auth";
import {
  normalizePresence,
  normalizeStatusMessage,
  serializeHomeStatus,
} from "../lib/home-status.js";
import { normalizeTemperatureUnit, type TemperatureUnit } from "../lib/weather-units.js";
import { avatarObjectKey, processAvatarUpload } from "../lib/avatar-image.js";
import { memberAvatarUrl } from "../lib/avatar-url.js";
import { deletePushSubscriptionForUser, isWebPushConfigured } from "../lib/push-notices.js";
import { createS3Client, deleteObject, getObjectBuffer, putObject } from "../lib/s3.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function profileRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/profile", async (c) => {
    const auth = c.get("auth")!;
    const shown = memberShownLabel(auth);
    let [status] = await db
      .select()
      .from(homeStatus)
      .where(
        and(eq(homeStatus.householdId, auth.householdId), eq(homeStatus.memberId, auth.memberId)),
      )
      .limit(1);
    if (!status) {
      const [created] = await db
        .insert(homeStatus)
        .values({
          householdId: auth.householdId,
          memberId: auth.memberId,
          name: shown.slice(0, 64),
          presence: "Away",
        })
        .returning();
      status = created;
    }

    const [userRow] = await db
      .select({
        temperatureUnit: users.temperatureUnit,
        pushNoticesEnabled: users.pushNoticesEnabled,
        pushCalendarRemindersEnabled: users.pushCalendarRemindersEnabled,
        pushChoresRemindersEnabled: users.pushChoresRemindersEnabled,
        pushExpenseBudgetAlertsEnabled: users.pushExpenseBudgetAlertsEnabled,
        pushSchoolRemindersEnabled: users.pushSchoolRemindersEnabled,
        pushShoppingRemindersEnabled: users.pushShoppingRemindersEnabled,
        pushHealthRemindersEnabled: users.pushHealthRemindersEnabled,
        calendarOverlaySchoolEnabled: users.calendarOverlaySchoolEnabled,
        calendarOverlayHealthEventsEnabled: users.calendarOverlayHealthEventsEnabled,
        calendarOverlayHealthMedsEnabled: users.calendarOverlayHealthMedsEnabled,
      })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    const [pushSub] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, auth.userId))
      .limit(1);

    const [memberRow] = await db
      .select({ avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);

    const home = serializeHomeStatus({
      presence: normalizePresence(status?.presence),
      statusMessage: status?.statusMessage ?? null,
    });

    return c.json({
      email: auth.email,
      username: auth.username,
      name: auth.name,
      shownLabel: shown,
      role: auth.role,
      memberId: auth.memberId,
      homeStatusId: status?.id ?? null,
      presence: home.presence,
      statusMessage: home.statusMessage,
      temperatureUnit: normalizeTemperatureUnit(userRow?.temperatureUnit),
      pushNoticesEnabled: userRow?.pushNoticesEnabled ?? true,
      pushCalendarRemindersEnabled: userRow?.pushCalendarRemindersEnabled ?? true,
      pushChoresRemindersEnabled: userRow?.pushChoresRemindersEnabled ?? true,
      pushExpenseBudgetAlertsEnabled: userRow?.pushExpenseBudgetAlertsEnabled ?? true,
      pushSchoolRemindersEnabled: userRow?.pushSchoolRemindersEnabled ?? true,
      pushShoppingRemindersEnabled: userRow?.pushShoppingRemindersEnabled ?? true,
      pushHealthRemindersEnabled: userRow?.pushHealthRemindersEnabled ?? true,
      calendarOverlaySchoolEnabled: userRow?.calendarOverlaySchoolEnabled ?? true,
      calendarOverlayHealthEventsEnabled: userRow?.calendarOverlayHealthEventsEnabled ?? true,
      calendarOverlayHealthMedsEnabled: userRow?.calendarOverlayHealthMedsEnabled ?? true,
      pushSubscribed: Boolean(pushSub),
      pushAvailable: isWebPushConfigured(env),
      avatarUrl: memberAvatarUrl(auth.memberId, memberRow?.avatarKey),
    });
  });

  app.patch("/profile", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      name?: string;
      temperatureUnit?: TemperatureUnit;
      pushNoticesEnabled?: boolean;
      pushCalendarRemindersEnabled?: boolean;
      pushChoresRemindersEnabled?: boolean;
      pushExpenseBudgetAlertsEnabled?: boolean;
      pushSchoolRemindersEnabled?: boolean;
      pushShoppingRemindersEnabled?: boolean;
      pushHealthRemindersEnabled?: boolean;
      calendarOverlaySchoolEnabled?: boolean;
      calendarOverlayHealthEventsEnabled?: boolean;
      calendarOverlayHealthMedsEnabled?: boolean;
    }>();

    const patch: {
      name?: string | null;
    } = {};
    const userPatch: {
      temperatureUnit?: TemperatureUnit;
      pushNoticesEnabled?: boolean;
      pushCalendarRemindersEnabled?: boolean;
      pushChoresRemindersEnabled?: boolean;
      pushExpenseBudgetAlertsEnabled?: boolean;
      pushSchoolRemindersEnabled?: boolean;
      pushShoppingRemindersEnabled?: boolean;
      pushHealthRemindersEnabled?: boolean;
      calendarOverlaySchoolEnabled?: boolean;
      calendarOverlayHealthEventsEnabled?: boolean;
      calendarOverlayHealthMedsEnabled?: boolean;
    } = {};
    if (body.name !== undefined) patch.name = body.name.trim().slice(0, 128) || null;
    if (body.temperatureUnit === "fahrenheit" || body.temperatureUnit === "celsius") {
      userPatch.temperatureUnit = body.temperatureUnit;
    }
    if (typeof body.pushNoticesEnabled === "boolean") {
      userPatch.pushNoticesEnabled = body.pushNoticesEnabled;
      if (!body.pushNoticesEnabled) {
        await deletePushSubscriptionForUser(db, auth.userId);
      }
    }
    if (typeof body.pushCalendarRemindersEnabled === "boolean") {
      userPatch.pushCalendarRemindersEnabled = body.pushCalendarRemindersEnabled;
    }
    if (typeof body.pushChoresRemindersEnabled === "boolean") {
      userPatch.pushChoresRemindersEnabled = body.pushChoresRemindersEnabled;
    }
    if (typeof body.pushExpenseBudgetAlertsEnabled === "boolean") {
      userPatch.pushExpenseBudgetAlertsEnabled = body.pushExpenseBudgetAlertsEnabled;
    }
    if (typeof body.pushSchoolRemindersEnabled === "boolean") {
      userPatch.pushSchoolRemindersEnabled = body.pushSchoolRemindersEnabled;
    }
    if (typeof body.pushShoppingRemindersEnabled === "boolean") {
      userPatch.pushShoppingRemindersEnabled = body.pushShoppingRemindersEnabled;
    }
    if (typeof body.pushHealthRemindersEnabled === "boolean") {
      userPatch.pushHealthRemindersEnabled = body.pushHealthRemindersEnabled;
    }
    if (typeof body.calendarOverlaySchoolEnabled === "boolean") {
      userPatch.calendarOverlaySchoolEnabled = body.calendarOverlaySchoolEnabled;
    }
    if (typeof body.calendarOverlayHealthEventsEnabled === "boolean") {
      userPatch.calendarOverlayHealthEventsEnabled = body.calendarOverlayHealthEventsEnabled;
    }
    if (typeof body.calendarOverlayHealthMedsEnabled === "boolean") {
      userPatch.calendarOverlayHealthMedsEnabled = body.calendarOverlayHealthMedsEnabled;
    }

    if (Object.keys(userPatch).length > 0) {
      await db.update(users).set(userPatch).where(eq(users.id, auth.userId));
    }

    if (Object.keys(patch).length > 0) {
      await db
        .update(householdMembers)
        .set(patch)
        .where(eq(householdMembers.id, auth.memberId));
    }

    const [member] = await db
      .select({
        name: householdMembers.name,
      })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);

    if (member) {
      const shown = memberShownLabel(member);
      await db
        .update(homeStatus)
        .set({ name: shown.slice(0, 64), updatedAt: new Date() })
        .where(
          and(eq(homeStatus.householdId, auth.householdId), eq(homeStatus.memberId, auth.memberId)),
        );
    }

    return c.json({ ok: true });
  });

  app.get("/avatars/:memberId", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.param("memberId");
    const [member] = await db
      .select({ avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, memberId),
          eq(householdMembers.householdId, auth.householdId),
        ),
      )
      .limit(1);
    if (!member?.avatarKey) return c.json({ error: "not_found" }, 404);

    const buf = await getObjectBuffer(env, member.avatarKey);
    if (!buf) return c.json({ error: "storage_unavailable" }, 503);

    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=300",
    });
  });

  app.post("/profile/avatar", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: "file_required" }, 400);
    }
    if (file.size > 2 * 1024 * 1024) {
      return c.json({ error: "file_too_large" }, 400);
    }

    let processed: Buffer;
    try {
      processed = await processAvatarUpload(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "invalid_image";
      if (msg === "file_too_large") return c.json({ error: msg }, 400);
      return c.json({ error: "invalid_image_type" }, 400);
    }

    const key = avatarObjectKey(auth.householdId, auth.memberId);
    try {
      await putObject(env, key, processed, "image/webp");
    } catch {
      return c.json({ error: "s3_not_configured" }, 503);
    }

    const [existing] = await db
      .select({ avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);
    if (existing?.avatarKey && existing.avatarKey !== key) {
      await deleteObject(env, existing.avatarKey).catch(() => undefined);
    }

    await db
      .update(householdMembers)
      .set({ avatarKey: key })
      .where(eq(householdMembers.id, auth.memberId));

    return c.json({
      ok: true,
      avatarUrl: memberAvatarUrl(auth.memberId, key),
    });
  });

  app.delete("/profile/avatar", async (c) => {
    const auth = c.get("auth")!;
    const [member] = await db
      .select({ avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);
    if (member?.avatarKey) {
      await deleteObject(env, member.avatarKey).catch(() => undefined);
      await db
        .update(householdMembers)
        .set({ avatarKey: null })
        .where(eq(householdMembers.id, auth.memberId));
    }
    return c.json({ ok: true });
  });

  return app;
}
