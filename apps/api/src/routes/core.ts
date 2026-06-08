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
  choresRecurring,
  expenses,
  homeStatus,
  householdMembers,
  noticeReads,
  notes,
  notices,
  shoppingItems,
  shoppingRecurring,
  shoppingTripItems,
  shoppingTrips,
  pushSubscriptions,
  users,
} from "@whome/db";
import { and, desc, eq } from "drizzle-orm";
import {
  buildShoppingReports,
  collectAisleSuggestions,
  materializeDueRecurring,
  normalizeRecurringInterval,
  parseShoppingTagsJson,
  serializeShoppingItem,
  serializeShoppingRecurring,
  serializeShoppingTagsJson,
  serializeShoppingTrip,
  shoppingReceiptObjectKey,
  isReceiptKeyForHousehold,
  todayIsoDate,
} from "../lib/shopping.js";
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
import {
  collectChoreTagSuggestions,
  materializeDueChoreRecurring,
  normalizeChorePriority,
  normalizeRecurringInterval as normalizeChoreRecurringInterval,
  promoteChoreToRecurring,
  serializeChore,
  serializeChoreRecurring,
  serializeChoreTagsJson,
} from "../lib/chores.js";
import {
  buildChoreReports,
  loadHouseholdKarma,
  recordChoreCompletion,
} from "../lib/chores-karma.js";
import { memberAvatarUrl } from "../lib/avatar-url.js";
import {
  claimEndpointForUser,
  deletePushSubscriptionForUser,
  isWebPushConfigured,
  notifyHouseholdOfNotice,
  upsertPushSubscription,
  type PushSubscriptionPayload,
} from "../lib/push-notices.js";
import {
  createS3Client,
  deleteObject,
  ensureS3ReadyOnce,
  getObjectBuffer,
  presignedPutUrl,
  putObject,
  contentTypeFromKey,
} from "../lib/s3.js";
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
    await materializeDueRecurring(db, auth.householdId);
    const rows = await db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    return c.json({ items: rows.map(serializeShoppingItem) });
  });

  app.get("/shopping/suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim().toLowerCase() ?? "";
    const rows = await db
      .select({ item: shoppingItems.item })
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const row of rows) {
      const name = row.item.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (q && !key.includes(q)) continue;
      seen.add(key);
      suggestions.push(name);
    }
    suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return c.json({ suggestions: suggestions.slice(0, 25) });
  });

  app.get("/shopping/aisle-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectAisleSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/shopping/recurring", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(shoppingRecurring)
      .where(eq(shoppingRecurring.householdId, auth.householdId))
      .orderBy(shoppingRecurring.item);
    return c.json({ recurring: rows.map(serializeShoppingRecurring) });
  });

  app.post("/shopping/recurring", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      item: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      interval?: string;
      nextAt?: string;
    }>();
    const item = body.item?.trim();
    if (!item) return c.json({ error: "item_required" }, 400);
    const interval = normalizeRecurringInterval(body.interval) ?? "weekly";
    const nextAt = body.nextAt?.trim() || todayIsoDate();
    const [row] = await db
      .insert(shoppingRecurring)
      .values({
        householdId: auth.householdId,
        item,
        tagsJson: serializeShoppingTagsJson(body.aisle, body.tags ?? []),
        quantity: body.quantity ?? null,
        unit: body.unit?.trim() || null,
        notes: body.notes?.trim() || null,
        interval,
        nextAt,
      })
      .returning();
    return c.json({ recurring: serializeShoppingRecurring(row) }, 201);
  });

  app.patch("/shopping/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      item?: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      interval?: string;
      nextAt?: string;
      enabled?: boolean;
    }>();

    const [existing] = await db
      .select()
      .from(shoppingRecurring)
      .where(and(eq(shoppingRecurring.id, id), eq(shoppingRecurring.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof shoppingRecurring.$inferInsert> = {};
    if (body.item !== undefined) patch.item = body.item.trim();
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.unit !== undefined) patch.unit = body.unit?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.nextAt !== undefined) patch.nextAt = body.nextAt.trim();
    if (body.interval !== undefined) {
      const interval = normalizeRecurringInterval(body.interval);
      if (!interval) return c.json({ error: "invalid_interval" }, 400);
      patch.interval = interval;
    }
    if (body.aisle !== undefined || body.tags !== undefined) {
      const current = parseShoppingTagsJson(existing.tagsJson);
      patch.tagsJson = serializeShoppingTagsJson(
        body.aisle !== undefined ? body.aisle : current.aisle,
        body.tags ?? current.tags,
      );
    }

    const [row] = await db
      .update(shoppingRecurring)
      .set(patch)
      .where(and(eq(shoppingRecurring.id, id), eq(shoppingRecurring.householdId, auth.householdId)))
      .returning();
    return c.json({ ok: true, recurring: row ? serializeShoppingRecurring(row) : undefined });
  });

  app.delete("/shopping/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(shoppingRecurring)
      .where(and(eq(shoppingRecurring.id, id), eq(shoppingRecurring.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/shopping/reports", async (c) => {
    const auth = c.get("auth")!;
    const to = c.req.query("to")?.trim() || todayIsoDate();
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = c.req.query("from")?.trim() || fromDefault.toISOString().slice(0, 10);
    const report = await buildShoppingReports(db, auth.householdId, from, to);
    return c.json(report);
  });

  app.post("/shopping/receipt/presign", async (c) => {
    const auth = c.get("auth")!;
    if (!createS3Client(env) || !env.S3_BUCKET) {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const body = await c.req.json<{ filename: string; contentType?: string }>();
    if (!body.filename?.trim()) return c.json({ error: "filename_required" }, 400);
    try {
      await ensureS3ReadyOnce(env);
    } catch {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const key = shoppingReceiptObjectKey(auth.householdId, body.filename.trim());
    const contentType = body.contentType?.trim() || "application/octet-stream";
    const uploadUrl = await presignedPutUrl(env, key, contentType);
    return c.json({ uploadUrl, key });
  });

  app.get("/shopping/trips/:id/receipt", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [trip] = await db
      .select()
      .from(shoppingTrips)
      .where(and(eq(shoppingTrips.id, id), eq(shoppingTrips.householdId, auth.householdId)))
      .limit(1);
    if (!trip?.receiptS3Key) return c.json({ error: "not_found" }, 404);
    const buf = await getObjectBuffer(env, trip.receiptS3Key);
    if (!buf) return c.json({ error: "not_found" }, 404);
    return new Response(buf, {
      headers: {
        "Content-Type": contentTypeFromKey(trip.receiptS3Key),
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.post("/shopping/clear", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      tripTotal?: number | null;
      receiptKey?: string | null;
      createExpense?: boolean;
      itemCosts?: Record<string, number>;
    }>();

    if (body.receiptKey && !isReceiptKeyForHousehold(auth.householdId, body.receiptKey)) {
      return c.json({ error: "invalid_receipt_key" }, 400);
    }

    const checkedRows = await db
      .select()
      .from(shoppingItems)
      .where(
        and(eq(shoppingItems.householdId, auth.householdId), eq(shoppingItems.checked, true)),
      );

    if (checkedRows.length === 0) {
      return c.json({ ok: true, deleted: 0, trip: null });
    }

    const itemCosts = body.itemCosts ?? {};
    let expenseId: string | null = null;

    const resolvedCosts = checkedRows.map((row) => {
      const fromBody = itemCosts[row.id];
      const cost =
        typeof fromBody === "number" && Number.isFinite(fromBody)
          ? fromBody
          : row.cost ?? null;
      return { row, cost };
    });

    const itemCostSum = resolvedCosts.reduce((sum, { cost }) => sum + (cost ?? 0), 0);
    const tripTotal =
      typeof body.tripTotal === "number" && Number.isFinite(body.tripTotal)
        ? body.tripTotal
        : itemCostSum > 0
          ? itemCostSum
          : null;

    if (body.createExpense && tripTotal != null && tripTotal > 0) {
      const [expense] = await db
        .insert(expenses)
        .values({
          householdId: auth.householdId,
          title: `Groceries (${checkedRows.length} items)`,
          amount: tripTotal,
          category: "Groceries",
          expenseDate: todayIsoDate(),
          createdByDisplayName: posterLabel(auth),
        })
        .returning({ id: expenses.id });
      expenseId = expense?.id ?? null;
    }

    const [trip] = await db
      .insert(shoppingTrips)
      .values({
        householdId: auth.householdId,
        tripTotal,
        receiptS3Key: body.receiptKey?.trim() || null,
        expenseId,
        itemCount: checkedRows.length,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();

    if (trip) {
      await db.insert(shoppingTripItems).values(
        resolvedCosts.map(({ row, cost }) => ({
          tripId: trip.id,
          item: row.item,
          tagsJson: row.tagsJson,
          quantity: row.quantity,
          unit: row.unit,
          notes: row.notes,
          cost,
        })),
      );
    }

    const deleted = await db
      .delete(shoppingItems)
      .where(
        and(eq(shoppingItems.householdId, auth.householdId), eq(shoppingItems.checked, true)),
      )
      .returning({ id: shoppingItems.id });

    return c.json({
      ok: true,
      deleted: deleted.length,
      trip: trip ? serializeShoppingTrip(trip) : null,
      expenseId,
    });
  });

  app.delete("/shopping/checked", async (c) => {
    const auth = c.get("auth")!;
    const deleted = await db
      .delete(shoppingItems)
      .where(
        and(eq(shoppingItems.householdId, auth.householdId), eq(shoppingItems.checked, true)),
      )
      .returning({ id: shoppingItems.id });
    return c.json({ ok: true, deleted: deleted.length });
  });

  app.post("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      item: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
    }>();
    const [row] = await db
      .insert(shoppingItems)
      .values({
        householdId: auth.householdId,
        item: body.item.trim(),
        tagsJson: serializeShoppingTagsJson(body.aisle, body.tags ?? []),
        quantity: body.quantity ?? null,
        unit: body.unit?.trim() || null,
        notes: body.notes?.trim() || null,
      })
      .returning();
    return c.json({ item: serializeShoppingItem(row) }, 201);
  });

  app.patch("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      checked?: boolean;
      item?: string;
      aisle?: string | null;
      tags?: string[];
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      cost?: number | null;
    }>();

    const [existing] = await db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof shoppingItems.$inferInsert> = {};
    if (body.checked !== undefined) patch.checked = body.checked;
    if (body.item !== undefined) patch.item = body.item.trim();
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.unit !== undefined) patch.unit = body.unit?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.cost !== undefined) patch.cost = body.cost;
    if (body.aisle !== undefined || body.tags !== undefined) {
      const current = parseShoppingTagsJson(existing.tagsJson);
      patch.tagsJson = serializeShoppingTagsJson(
        body.aisle !== undefined ? body.aisle : current.aisle,
        body.tags ?? current.tags,
      );
    }

    const [row] = await db
      .update(shoppingItems)
      .set(patch)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)))
      .returning();
    return c.json({ ok: true, item: row ? serializeShoppingItem(row) : undefined });
  });

  app.delete("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/chores/karma", async (c) => {
    const auth = c.get("auth")!;
    const members = await loadHouseholdKarma(db, auth.householdId);
    return c.json({ members });
  });

  app.get("/chores/reports", async (c) => {
    const auth = c.get("auth")!;
    const to = c.req.query("to")?.trim() || todayIsoDate();
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = c.req.query("from")?.trim() || fromDefault.toISOString().slice(0, 10);
    const report = await buildChoreReports(db, auth.householdId, from, to);
    return c.json(report);
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
        priority: chores.priority,
      })
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json(buildChoresGlance(rows, today));
  });

  app.get("/chores/tag-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectChoreTagSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/chores/recurring", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(choresRecurring)
      .where(eq(choresRecurring.householdId, auth.householdId))
      .orderBy(choresRecurring.description);
    return c.json({ recurring: rows.map(serializeChoreRecurring) });
  });

  app.post("/chores/recurring", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      description: string;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
      interval?: string;
      nextAt?: string;
    }>();
    const description = body.description?.trim();
    if (!description) return c.json({ error: "description_required" }, 400);
    const interval = normalizeChoreRecurringInterval(body.interval) ?? "weekly";
    const nextAt = body.nextAt?.trim() || todayIsoDate();
    const priority = body.priority !== undefined ? normalizeChorePriority(body.priority) : 0;
    if (body.priority !== undefined && priority === null) {
      return c.json({ error: "invalid_priority" }, 400);
    }
    const [row] = await db
      .insert(choresRecurring)
      .values({
        householdId: auth.householdId,
        description,
        tagsJson: serializeChoreTagsJson(body.tags ?? []),
        priority: priority ?? 0,
        assigneeMemberId: body.assigneeMemberId ?? null,
        interval,
        nextAt,
      })
      .returning();
    return c.json({ recurring: serializeChoreRecurring(row) }, 201);
  });

  app.patch("/chores/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      description?: string;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
      interval?: string;
      nextAt?: string;
      enabled?: boolean;
    }>();

    const [existing] = await db
      .select()
      .from(choresRecurring)
      .where(and(eq(choresRecurring.id, id), eq(choresRecurring.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof choresRecurring.$inferInsert> = {};
    if (body.description !== undefined) patch.description = body.description.trim();
    if (body.assigneeMemberId !== undefined) patch.assigneeMemberId = body.assigneeMemberId;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.nextAt !== undefined) patch.nextAt = body.nextAt.trim();
    if (body.interval !== undefined) {
      const interval = normalizeChoreRecurringInterval(body.interval);
      if (!interval) return c.json({ error: "invalid_interval" }, 400);
      patch.interval = interval;
    }
    if (body.priority !== undefined) {
      const priority = normalizeChorePriority(body.priority);
      if (priority === null) return c.json({ error: "invalid_priority" }, 400);
      patch.priority = priority;
    }
    if (body.tags !== undefined) {
      patch.tagsJson = serializeChoreTagsJson(body.tags);
    }

    const [row] = await db
      .update(choresRecurring)
      .set(patch)
      .where(and(eq(choresRecurring.id, id), eq(choresRecurring.householdId, auth.householdId)))
      .returning();
    return c.json({ ok: true, recurring: row ? serializeChoreRecurring(row) : undefined });
  });

  app.delete("/chores/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(choresRecurring)
      .where(and(eq(choresRecurring.id, id), eq(choresRecurring.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/chores", async (c) => {
    const auth = c.get("auth")!;
    await materializeDueChoreRecurring(db, auth.householdId);
    const rows = await db
      .select()
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json({ chores: rows.map(serializeChore) });
  });

  app.post("/chores", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      description: string;
      dueDate?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
    }>();
    const description = body.description?.trim();
    if (!description) return c.json({ error: "description_required" }, 400);
    const priority = body.priority !== undefined ? normalizeChorePriority(body.priority) : 0;
    if (body.priority !== undefined && priority === null) {
      return c.json({ error: "invalid_priority" }, 400);
    }
    const [row] = await db
      .insert(chores)
      .values({
        householdId: auth.householdId,
        description,
        dueDate: body.dueDate?.trim() || null,
        tagsJson: serializeChoreTagsJson(body.tags ?? []),
        priority: priority ?? 0,
        assigneeMemberId: body.assigneeMemberId ?? null,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    return c.json({ chore: serializeChore(row) }, 201);
  });

  app.post("/chores/:id/make-recurring", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      interval?: string;
      description?: string;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
      dueDate?: string | null;
    }>();

    const interval = normalizeChoreRecurringInterval(body.interval) ?? "weekly";
    if (body.interval !== undefined && body.interval !== null && body.interval !== "") {
      const normalized = normalizeChoreRecurringInterval(body.interval);
      if (!normalized) return c.json({ error: "invalid_interval" }, 400);
    }

    let priority: ReturnType<typeof normalizeChorePriority> | undefined;
    if (body.priority !== undefined) {
      priority = normalizeChorePriority(body.priority);
      if (priority === null) return c.json({ error: "invalid_priority" }, 400);
    }

    const result = await promoteChoreToRecurring(db, auth.householdId, id, {
      interval,
      description: body.description,
      tags: body.tags,
      priority: priority ?? undefined,
      assigneeMemberId: body.assigneeMemberId,
      dueDate: body.dueDate,
    });

    if (!result.ok) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      if (result.error === "already_recurring") {
        return c.json({ error: "already_recurring" }, 409);
      }
      if (result.error === "already_completed") {
        return c.json({ error: "already_completed" }, 409);
      }
      return c.json({ error: result.error }, 400);
    }

    return c.json(
      {
        chore: serializeChore(result.chore),
        recurring: serializeChoreRecurring(result.recurring),
      },
      201,
    );
  });

  app.patch("/chores/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      done?: boolean;
      description?: string;
      dueDate?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
    }>();

    const [existing] = await db
      .select()
      .from(chores)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof chores.$inferInsert> & { dueReminderSentAt?: Date | null } = {};
    if (body.done !== undefined) patch.done = body.done;
    if (body.description !== undefined) patch.description = body.description.trim();
    if (body.assigneeMemberId !== undefined) patch.assigneeMemberId = body.assigneeMemberId;
    if (body.dueDate !== undefined) {
      patch.dueDate = body.dueDate?.trim() || null;
      patch.dueReminderSentAt = null;
    }
    if (body.priority !== undefined) {
      const priority = normalizeChorePriority(body.priority);
      if (priority === null) return c.json({ error: "invalid_priority" }, 400);
      patch.priority = priority;
    }
    if (body.tags !== undefined) {
      patch.tagsJson = serializeChoreTagsJson(body.tags);
    }
    if (body.done === true) {
      patch.dueReminderSentAt = null;
    }

    let completion: Awaited<ReturnType<typeof recordChoreCompletion>> | undefined;
    if (body.done === true && !existing.done) {
      completion = await recordChoreCompletion(db, {
        householdId: auth.householdId,
        chore: existing,
        completedByMemberId: auth.memberId,
      });
    }

    const [row] = await db
      .update(chores)
      .set(patch)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)))
      .returning();
    return c.json({
      ok: true,
      chore: row ? serializeChore(row) : undefined,
      completion: completion
        ? {
            karmaEarned: completion.karmaEarned,
            timing: completion.timing,
            daysLate: completion.daysLate,
            streakBonus: completion.streakBonus,
            currentStreak: completion.currentStreak,
          }
        : undefined,
    });
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
        pushChoresRemindersEnabled: users.pushChoresRemindersEnabled,
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
    }>();

    const patch: {
      name?: string | null;
    } = {};
    const userPatch: {
      temperatureUnit?: TemperatureUnit;
      pushNoticesEnabled?: boolean;
      pushCalendarRemindersEnabled?: boolean;
      pushChoresRemindersEnabled?: boolean;
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
