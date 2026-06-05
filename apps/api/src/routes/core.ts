import { Hono } from "hono";
import {
  canProvisionMembers,
  isUsernameAvailable,
  listHouseholdMembersWithAuth,
  memberShownLabel,
  ProvisionMemberError,
  provisionUsernameMember,
} from "@whome/auth";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import type { Database } from "@whome/db";
import {
  chores,
  expenses,
  homeStatus,
  householdMembers,
  noticeReads,
  notes,
  notices,
  shoppingItems,
  pushSubscriptions,
  users,
} from "@whome/db";
import { and, desc, eq } from "drizzle-orm";
import type { AuthContext } from "@whome/auth";
import {
  normalizePresence,
  normalizeStatusMessage,
  serializeHomeStatus,
} from "../lib/home-status.js";
import { formatGeocodeLabel, searchOpenMeteoLocations } from "../lib/open-meteo.js";
import { fetchWeatherForLocation } from "../lib/weather-fetch.js";
import type { WeatherErrorCode } from "../lib/weather-errors.js";
import {
  applyTemperatureUnit,
  normalizeTemperatureUnit,
  type TemperatureUnit,
} from "../lib/weather-units.js";
import { avatarObjectKey, processAvatarUpload } from "../lib/avatar-image.js";
import { buildChoresGlance } from "../lib/chores-glance.js";
import { memberAvatarUrl } from "../lib/avatar-url.js";
import {
  claimEndpointForUser,
  deletePushSubscriptionForUser,
  isWebPushConfigured,
  notifyHouseholdOfNotice,
  upsertPushSubscription,
  type PushSubscriptionPayload,
} from "../lib/push-notices.js";
import { deleteObject, getObjectBuffer, putObject } from "../lib/s3.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

function posterLabel(auth: AuthContext): string {
  return memberShownLabel({ name: auth.name }) || auth.email || auth.username || "Member";
}

type NoticeRow = typeof notices.$inferSelect;

async function mapNoticesForUser(
  db: Database,
  userId: string,
  rows: NoticeRow[],
) {
  if (rows.length === 0) return [];
  const reads = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, userId));
  const readSet = new Set(reads.map((r) => r.noticeId));

  return rows.map((n) => {
    const isOwn = n.postedByUserId === userId;
    const read = isOwn || readSet.has(n.id);
    return {
      id: n.id,
      content: n.content,
      postedByUserId: n.postedByUserId,
      postedByDisplayName: n.updatedByDisplayName,
      createdAt: (n.createdAt ?? n.updatedAt).toISOString(),
      read,
      isOwn,
    };
  });
}

function countUnread(
  userId: string,
  mapped: Awaited<ReturnType<typeof mapNoticesForUser>>,
): number {
  return mapped.filter((n) => !n.isOwn && !n.read).length;
}

export function coreRoutes(db: Database, env: Env) {
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

  app.get("/weather/geocode", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    if (q.length < 2) return c.json({ results: [] });
    try {
      const hits = await searchOpenMeteoLocations(q);
      return c.json({
        results: hits.map((r) => ({
          id: r.id,
          label: formatGeocodeLabel(r),
          latitude: r.latitude,
          longitude: r.longitude,
        })),
      });
    } catch {
      return c.json({ results: [] }, 502);
    }
  });

  app.get("/weather", async (c) => {
    const auth = c.get("auth")!;
    const qLat = c.req.query("lat");
    const qLon = c.req.query("lon");
    let lat = qLat ? Number(qLat) : NaN;
    let lon = qLon ? Number(qLon) : NaN;
    let locationLabel = c.req.query("label")?.trim() || null;
    const dateParam = c.req.query("date")?.trim();
    const dateKey =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : "today";

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      lat = env.WEATHER_LATITUDE ? Number(env.WEATHER_LATITUDE) : NaN;
      lon = env.WEATHER_LONGITUDE ? Number(env.WEATHER_LONGITUDE) : NaN;
      locationLabel = locationLabel ?? env.WEATHER_LOCATION_LABEL ?? null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return c.json({ ok: false, error: "needsLocation" as WeatherErrorCode });
    }

    const [userRow] = await db
      .select({ temperatureUnit: users.temperatureUnit })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    const temperatureUnit = normalizeTemperatureUnit(userRow?.temperatureUnit);

    const result = await fetchWeatherForLocation(env, lat, lon, dateKey);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 502);
    }

    const converted = applyTemperatureUnit(result.payload, temperatureUnit);
    const hourlyForDate = dateKey === "today" ? converted.todayHourly : converted.dayHourly;

    return c.json(
      {
        ok: true,
        source: result.source,
        cached: result.cached,
        date: dateKey,
        temperatureUnit,
        timezone: converted.timezone,
        locationLabel: locationLabel ?? converted.locationLabel,
        current: converted.current,
        todayHourly: converted.todayHourly,
        dayHourly: hourlyForDate,
      },
      200,
      { "Cache-Control": "public, max-age=600" },
    );
  });

  app.get("/notices", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .orderBy(desc(notices.createdAt), desc(notices.updatedAt))
      .limit(50);
    const mapped = await mapNoticesForUser(db, auth.userId, rows);
    const unreadCount = countUnread(auth.userId, mapped);
    const latest = mapped[0] ?? null;
    return c.json({ notices: mapped, unreadCount, latest });
  });

  app.get("/notices/unread-count", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .orderBy(desc(notices.createdAt), desc(notices.updatedAt))
      .limit(50);
    const mapped = await mapNoticesForUser(db, auth.userId, rows);
    return c.json({ unreadCount: countUnread(auth.userId, mapped) });
  });

  app.post("/notices", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ content: string }>();
    const content = (body.content ?? "").trim();
    if (!content) return c.json({ error: "content_required" }, 400);
    const now = new Date();
    const label = posterLabel(auth);
    const [row] = await db
      .insert(notices)
      .values({
        householdId: auth.householdId,
        content,
        postedByUserId: auth.userId,
        updatedByDisplayName: label,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db
      .insert(noticeReads)
      .values({ noticeId: row.id, userId: auth.userId })
      .onConflictDoNothing({ target: [noticeReads.noticeId, noticeReads.userId] });
    const [mapped] = await mapNoticesForUser(db, auth.userId, [row]);
    void notifyHouseholdOfNotice(db, env, {
      householdId: auth.householdId,
      posterUserId: auth.userId,
      noticeId: row.id,
      content,
      posterDisplayName: label,
    }).catch(() => {
      /* push is best-effort */
    });
    return c.json({ notice: mapped }, 201);
  });

  app.get("/push/vapid-public-key", async (c) => {
    if (!isWebPushConfigured(env)) {
      return c.json({ enabled: false, publicKey: null });
    }
    return c.json({ enabled: true, publicKey: env.VAPID_PUBLIC_KEY ?? null });
  });

  app.post("/push/subscribe", async (c) => {
    const auth = c.get("auth")!;
    if (!isWebPushConfigured(env)) {
      return c.json({ error: "push_not_configured" }, 503);
    }
    const body = await c.req.json<PushSubscriptionPayload>();
    if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return c.json({ error: "invalid_subscription" }, 400);
    }
    await claimEndpointForUser(db, auth.userId, body.endpoint);
    await upsertPushSubscription(db, auth.userId, body);
    return c.json({ ok: true });
  });

  app.delete("/push/subscribe", async (c) => {
    const auth = c.get("auth")!;
    let endpoint: string | undefined;
    try {
      const body = await c.req.json<{ endpoint?: string }>();
      endpoint = body.endpoint;
    } catch {
      /* no body — remove all subs for user */
    }
    await deletePushSubscriptionForUser(db, auth.userId, endpoint);
    return c.json({ ok: true });
  });

  app.post("/notices/:id/read", async (c) => {
    const auth = c.get("auth")!;
    const noticeId = c.req.param("id");
    const [row] = await db
      .select()
      .from(notices)
      .where(and(eq(notices.id, noticeId), eq(notices.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    await db
      .insert(noticeReads)
      .values({ noticeId, userId: auth.userId })
      .onConflictDoNothing({ target: [noticeReads.noticeId, noticeReads.userId] });
    return c.json({ ok: true });
  });

  app.post("/notices/read-all", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({ id: notices.id, postedByUserId: notices.postedByUserId })
      .from(notices)
      .where(eq(notices.householdId, auth.householdId));
    const toMark = rows.filter((n) => n.postedByUserId !== auth.userId);
    if (toMark.length > 0) {
      await db
        .insert(noticeReads)
        .values(toMark.map((n) => ({ noticeId: n.id, userId: auth.userId })))
        .onConflictDoNothing({ target: [noticeReads.noticeId, noticeReads.userId] });
    }
    return c.json({ ok: true });
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

  app.get("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const items = await db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    return c.json({ items });
  });

  app.post("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ item: string }>();
    const [row] = await db
      .insert(shoppingItems)
      .values({ householdId: auth.householdId, item: body.item })
      .returning();
    return c.json({ item: row }, 201);
  });

  app.patch("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ checked?: boolean; item?: string }>();
    const patch: { checked?: boolean; item?: string } = {};
    if (body.checked !== undefined) patch.checked = body.checked;
    if (body.item !== undefined) patch.item = body.item;
    await db
      .update(shoppingItems)
      .set(patch)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.delete("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/chores/glance", async (c) => {
    const auth = c.get("auth")!;
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select({
        id: chores.id,
        description: chores.description,
        dueDate: chores.dueDate,
        done: chores.done,
      })
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json(buildChoresGlance(rows, today));
  });

  app.get("/chores", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json({ chores: rows });
  });

  app.post("/chores", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ description: string; dueDate?: string }>();
    const [row] = await db
      .insert(chores)
      .values({
        householdId: auth.householdId,
        description: body.description,
        dueDate: body.dueDate ?? null,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    return c.json({ chore: row }, 201);
  });

  app.patch("/chores/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ done?: boolean; description?: string }>();
    const patch: { done?: boolean; description?: string } = {};
    if (body.done !== undefined) patch.done = body.done;
    if (body.description !== undefined) patch.description = body.description;
    await db
      .update(chores)
      .set(patch)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.delete("/chores/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(chores)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/notes", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(notes)
      .where(eq(notes.householdId, auth.householdId))
      .limit(50);
    return c.json({ notes: rows });
  });

  app.post("/notes", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ content: string }>();
    const [row] = await db
      .insert(notes)
      .values({
        householdId: auth.householdId,
        content: body.content,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    return c.json({ note: row }, 201);
  });

  app.patch("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ content: string }>();
    await db
      .update(notes)
      .set({ content: body.content })
      .where(and(eq(notes.id, id), eq(notes.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.delete("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(notes)
      .where(and(eq(notes.id, id), eq(notes.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.householdId, auth.householdId))
      .limit(100);
    return c.json({ expenses: rows });
  });

  app.post("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      amount: number;
      category?: string;
      expenseDate: string;
    }>();
    const [row] = await db
      .insert(expenses)
      .values({
        householdId: auth.householdId,
        title: body.title,
        amount: body.amount,
        category: body.category,
        expenseDate: body.expenseDate,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    return c.json({ expense: row }, 201);
  });

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
    }>();

    const patch: {
      name?: string | null;
    } = {};
    const userPatch: {
      temperatureUnit?: TemperatureUnit;
      pushNoticesEnabled?: boolean;
      pushCalendarRemindersEnabled?: boolean;
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

  app.patch("/expenses/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      amount?: number;
      category?: string;
      expenseDate?: string;
    }>();
    await db
      .update(expenses)
      .set(body)
      .where(and(eq(expenses.id, id), eq(expenses.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/household/members", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const members = await listHouseholdMembersWithAuth(db, auth.householdId);
    return c.json({ members });
  });

  app.get("/household/usernames/available", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const username = c.req.query("username") ?? "";
    const available = await isUsernameAvailable(db, username);
    return c.json({ available });
  });

  app.post("/household/members/provision", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{
      username?: string;
      displayName?: string;
      password?: string;
      role?: "child" | "member" | "guest";
    }>();
    if (!body.username?.trim() || !body.password || !body.displayName?.trim()) {
      return c.json({ error: "username_display_name_and_password_required" }, 400);
    }
    const role =
      body.role === "child" || body.role === "guest" || body.role === "member"
        ? body.role
        : "child";
    try {
      const created = await provisionUsernameMember(db, {
        householdId: auth.householdId,
        username: body.username,
        displayName: body.displayName,
        password: body.password,
        role,
      });
      return c.json(created, 201);
    } catch (e) {
      if (e instanceof ProvisionMemberError) {
        return c.json({ error: e.code, message: e.message }, 400);
      }
      throw e;
    }
  });

  return app;
}
