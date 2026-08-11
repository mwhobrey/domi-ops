import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  canProvisionMembers,
  isUsernameAvailable,
  listHouseholdMembersWithAuth,
  memberShownLabel,
  ProvisionMemberError,
  provisionUsernameMember,
  UpdateMemberRoleError,
  updateHouseholdMemberRole,
  isHouseholdMemberRole,
} from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import {
  householdModuleCeiling,
  isModuleEnabled,
  normalizeHouseholdModulesSelection,
} from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { checkHouseholdBudgetAlerts } from "@domi-ops/calendar-sync";
import {
  chores,
  choresRecurring,
  calendarConnections,
  driveObjects,
  driveReferences,
  expenseBudgets,
  expenses,
  homeStatus,
  households,
  householdMembers,
  noticeReads,
  noteShares,
  notes,
  notices,
  shoppingItems,
  shoppingRecurring,
  shoppingTripItems,
  shoppingTrips,
  pushSubscriptions,
  userNotifications,
  users,
} from "@domi-ops/db";
import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
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
import type { AuthContext } from "@domi-ops/auth";
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
import { memberAvatarUrl } from "../lib/avatar-url.js";
import { buildChoresGlance } from "../lib/chores-glance.js";
import { buildShoppingGlance } from "../lib/shopping-glance.js";
import {
  collectChoreListSuggestions,
  collectChoreTagSuggestions,
  materializeDueChoreRecurring,
  normalizeChorePriority,
  normalizeRecurringInterval as normalizeChoreRecurringInterval,
  parseChoreTagsJson,
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
import {
  buildExpenseReports,
  collectExpenseCategorySuggestions,
  currentMonthKey,
  normalizeExpenseCategory,
  normalizeMonthKey,
  serializeExpense,
  summarizeBudgetRow,
} from "../lib/expenses.js";
import {
  canWriteBudget,
  isBudgetOwner,
  listVisibleBudgets,
  loadBudgetShareRows,
  replaceExpenseBudgetShares,
  validateBudgetShareMemberIds,
  type ExpenseBudgetShareAccess,
} from "../lib/expense-budget-access.js";
import {
  collectNoteTagSuggestions,
  normalizeNoteTitle,
  parseNoteTagsJson,
  serializeNoteTagsJson,
} from "../lib/notes.js";
import {
  DEFAULT_DRIVE_ROLE_PERMISSIONS,
  normalizeDrivePermissionsPatch,
  parseDrivePermissionsJson,
  serializeDrivePermissionsJson,
  type DriveRolePermissions,
} from "../lib/drive-permissions.js";
import {
  driveEmbedsForContent,
  loadDriveEmbedObjects,
  parseDriveEmbedIds,
  type DriveEmbedDto,
} from "../lib/drive-embeds.js";
import { getHouseholdModuleContext } from "../lib/household-entitlements.js";
import { driveVisibleWhere, filenameFromDriveKey } from "../lib/drive.js";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import { notifyShoppingRecurringMaterialized } from "../lib/push-shopping.js";
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
  putObject,
  contentTypeFromKey,
} from "../lib/s3.js";
import { browserUploadPutUrl } from "../lib/upload-token.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

function posterLabel(auth: AuthContext): string {
  return memberShownLabel({ name: auth.name }) || auth.email || auth.username || "Member";
}

type NoteRow = typeof notes.$inferSelect;
type NoteVisibility = "private" | "household";

function normalizeNoteVisibility(value: unknown): NoteVisibility {
  return value === "private" ? "private" : "household";
}

function noteVisibleWhere(db: Database, auth: AuthContext) {
  return and(
    eq(notes.householdId, auth.householdId),
    or(
      eq(notes.visibility, "household"),
      and(eq(notes.visibility, "private"), eq(notes.createdByUserId, auth.userId)),
      and(
        eq(notes.visibility, "private"),
        exists(
          db
            .select({ noteId: noteShares.noteId })
            .from(noteShares)
            .where(
              and(eq(noteShares.noteId, notes.id), eq(noteShares.memberId, auth.memberId)),
            ),
        ),
      ),
    ),
  );
}

function noteMutableWhere(id: string, auth: AuthContext) {
  return and(
    eq(notes.id, id),
    eq(notes.householdId, auth.householdId),
    or(eq(notes.visibility, "household"), eq(notes.createdByUserId, auth.userId)),
  );
}

async function loadNoteShareMap(db: Database, noteIds: string[]) {
  const map = new Map<string, string[]>();
  if (noteIds.length === 0) return map;
  const rows = await db
    .select({ noteId: noteShares.noteId, memberId: noteShares.memberId })
    .from(noteShares)
    .where(inArray(noteShares.noteId, noteIds));
  for (const row of rows) {
    const list = map.get(row.noteId) ?? [];
    list.push(row.memberId);
    map.set(row.noteId, list);
  }
  return map;
}

async function validateShareMemberIds(
  db: Database,
  householdId: string,
  memberIds: string[],
  excludeMemberId?: string,
) {
  const unique = [...new Set(memberIds.filter((id) => id && id !== excludeMemberId))];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, unique)),
    );
  const valid = new Set(rows.map((r) => r.id));
  return unique.filter((id) => valid.has(id));
}

async function replaceNoteShares(
  db: Database,
  noteId: string,
  memberIds: string[],
) {
  await db.delete(noteShares).where(eq(noteShares.noteId, noteId));
  if (memberIds.length === 0) return;
  await db.insert(noteShares).values(
    memberIds.map((memberId) => ({
      noteId,
      memberId,
    })),
  );
}

function noteListWhere(db: Database, auth: AuthContext, q?: string, tag?: string) {
  const conditions = [noteVisibleWhere(db, auth)];
  const trimmedQ = q?.trim();
  if (trimmedQ) {
    conditions.push(
      or(ilike(notes.title, `%${trimmedQ}%`), ilike(notes.content, `%${trimmedQ}%`)),
    );
  }
  const trimmedTag = tag?.trim();
  if (trimmedTag) {
    conditions.push(
      sql`exists (
        select 1 from jsonb_array_elements_text(coalesce(${notes.tagsJson}::jsonb, '[]'::jsonb)) as note_tag
        where lower(note_tag) = lower(${trimmedTag})
      )`,
    );
  }
  return and(...conditions);
}

function serializeNote(
  row: NoteRow,
  auth: AuthContext,
  shareMap: Map<string, string[]>,
  attachmentMap?: Map<string, DriveAttachmentDto[]>,
  driveEmbedMap?: Map<string, DriveEmbedDto>,
  driveEnabled = false,
) {
  const sharedMemberIds = shareMap.get(row.id) ?? [];
  const isOwnedByMe = row.createdByUserId === auth.userId;
  const sharedWithMe =
    row.visibility === "private" &&
    !isOwnedByMe &&
    sharedMemberIds.includes(auth.memberId);
  const embedIds = driveEnabled ? parseDriveEmbedIds(row.content) : [];
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: row.pinned,
    tags: parseNoteTagsJson(row.tagsJson),
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    createdByDisplayName: row.createdByDisplayName,
    createdAt: row.createdAt,
    isOwnedByMe,
    sharedWithMe,
    sharedMemberIds: isOwnedByMe ? sharedMemberIds : undefined,
    driveAttachments: attachmentMap?.get(row.id) ?? [],
    driveEmbeds:
      driveEnabled && embedIds.length > 0 && driveEmbedMap
        ? driveEmbedsForContent(row.content, driveEmbedMap)
        : undefined,
  };
}

type NoticeRow = typeof notices.$inferSelect;

type DriveAttachmentDto = {
  id: string;
  driveObjectId: string;
  title: string;
  kind: string;
  filename: string | null;
  url: string | null;
};

async function loadEntityDriveAttachments(
  db: Database,
  auth: AuthContext,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, DriveAttachmentDto[]>> {
  const map = new Map<string, DriveAttachmentDto[]>();
  if (entityIds.length === 0) return map;

  const rows = await db
    .select({
      id: driveReferences.id,
      entityId: driveReferences.entityId,
      driveObjectId: driveReferences.driveObjectId,
      title: driveObjects.title,
      kind: driveObjects.kind,
      url: driveObjects.url,
      s3Key: driveObjects.s3Key,
    })
    .from(driveReferences)
    .innerJoin(driveObjects, eq(driveReferences.driveObjectId, driveObjects.id))
    .where(
      and(
        eq(driveReferences.entityType, entityType),
        inArray(driveReferences.entityId, entityIds),
        driveVisibleWhere(db, auth),
      ),
    );

  for (const row of rows) {
    const list = map.get(row.entityId) ?? [];
    list.push({
      id: row.id,
      driveObjectId: row.driveObjectId,
      title: row.title,
      kind: row.kind,
      filename: row.s3Key ? filenameFromDriveKey(row.s3Key) : null,
      url: row.url,
    });
    map.set(row.entityId, list);
  }
  return map;
}

async function mapNoticesForUser(
  db: Database,
  auth: AuthContext,
  rows: NoticeRow[],
  includeAttachments: boolean,
) {
  if (rows.length === 0) return [];
  const reads = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, auth.userId));
  const readSet = new Set(reads.map((r) => r.noticeId));

  const attachmentMap = includeAttachments
    ? await loadEntityDriveAttachments(
        db,
        auth,
        "notice",
        rows.map((n) => n.id),
      )
    : new Map<string, DriveAttachmentDto[]>();

  return rows.map((n) => {
    const isOwn = n.postedByUserId === auth.userId;
    const read = isOwn || readSet.has(n.id);
    return {
      id: n.id,
      content: n.content,
      postedByUserId: n.postedByUserId,
      postedByDisplayName: n.updatedByDisplayName,
      createdAt: (n.createdAt ?? n.updatedAt).toISOString(),
      read,
      isOwn,
      attachments: attachmentMap.get(n.id) ?? [],
    };
  });
}

function countUnread(
  userId: string,
  mapped: { isOwn: boolean; read: boolean }[],
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
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const rows = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .orderBy(desc(notices.createdAt), desc(notices.updatedAt))
      .limit(50);
    const mapped = await mapNoticesForUser(db, auth, rows, driveEnabled);
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
    const mapped = await mapNoticesForUser(db, auth, rows, false);
    return c.json({ unreadCount: countUnread(auth.userId, mapped) });
  });

  app.get("/notifications", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, auth.userId))
      .orderBy(desc(userNotifications.createdAt))
      .limit(50);
    const unreadCount = rows.filter((r) => r.readAt == null).length;
    return c.json({
      notifications: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        url: r.url,
        tag: r.tag,
        read: r.readAt != null,
        createdAt: r.createdAt.toISOString(),
      })),
      unreadCount,
    });
  });

  app.get("/notifications/unread-count", async (c) => {
    const auth = c.get("auth")!;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userNotifications)
      .where(
        and(eq(userNotifications.userId, auth.userId), sql`${userNotifications.readAt} IS NULL`),
      );
    return c.json({ unreadCount: Number(row?.count ?? 0) });
  });

  app.post("/notifications/mark-read", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ ids?: string[]; all?: boolean }>();
    const now = new Date();
    if (body.all) {
      await db
        .update(userNotifications)
        .set({ readAt: now })
        .where(
          and(eq(userNotifications.userId, auth.userId), sql`${userNotifications.readAt} IS NULL`),
        );
      return c.json({ ok: true });
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    if (ids.length === 0) return c.json({ error: "ids_required" }, 400);
    await db
      .update(userNotifications)
      .set({ readAt: now })
      .where(
        and(eq(userNotifications.userId, auth.userId), inArray(userNotifications.id, ids)),
      );
    return c.json({ ok: true });
  });

  app.post("/notices", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ content: string; driveObjectIds?: string[] }>();
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

    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    if (driveEnabled && Array.isArray(body.driveObjectIds) && body.driveObjectIds.length > 0) {
      const uniqueIds = [...new Set(body.driveObjectIds.map((id) => id.trim()).filter(Boolean))];
      for (const objectId of uniqueIds) {
        const [object] = await db
          .select({ id: driveObjects.id })
          .from(driveObjects)
          .where(and(eq(driveObjects.id, objectId), driveVisibleWhere(db, auth)))
          .limit(1);
        if (!object) continue;
        try {
          await db.insert(driveReferences).values({
            driveObjectId: objectId,
            entityType: "notice",
            entityId: row.id,
            createdByUserId: auth.userId,
          });
        } catch {
          /* duplicate reference — skip */
        }
      }
    }

    const [mapped] = await mapNoticesForUser(db, auth, [row], driveEnabled);
    void notifyHouseholdOfNotice(db, env, {
      householdId: auth.householdId,
      posterUserId: auth.userId,
      noticeId: row.id,
      content,
      posterDisplayName: label,
    }).catch((err) => {
      if (env.NODE_ENV === "development") {
        console.error("[domi-ops] notice push failed", err);
      }
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
    const body = await c.req.json<PushSubscriptionPayload & { timezone?: string }>();
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
    const { created, itemNames } = await materializeDueRecurring(db, auth.householdId);
    if (created > 0) {
      void notifyShoppingRecurringMaterialized(db, env, {
        householdId: auth.householdId,
        itemNames,
      }).catch(() => {
        /* best-effort */
      });
    }
    const rows = await db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    return c.json({ items: rows.map(serializeShoppingItem) });
  });

  app.get("/shopping/glance", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({
        id: shoppingItems.id,
        item: shoppingItems.item,
        checked: shoppingItems.checked,
        quantity: shoppingItems.quantity,
        unit: shoppingItems.unit,
        tagsJson: shoppingItems.tagsJson,
      })
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId))
      .orderBy(shoppingItems.createdAt);
    const mapped = rows.map((row) => {
      const { aisle } = parseShoppingTagsJson(row.tagsJson);
      return {
        id: row.id,
        item: row.item,
        checked: row.checked,
        aisle,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
      };
    });
    return c.json(buildShoppingGlance(mapped));
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
    const uploadId = randomUUID();
    const uploadUrl = browserUploadPutUrl(env, {
      uploadId,
      key,
      householdId: auth.householdId,
      memberId: auth.memberId,
      contentType,
      maxBytes: null,
    });
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

  app.get("/chores/list-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectChoreListSuggestions(db, auth.householdId, q);
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
      list?: string | null;
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
        tagsJson: serializeChoreTagsJson(body.list, body.tags ?? []),
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
      list?: string | null;
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
    if (body.list !== undefined || body.tags !== undefined) {
      const current = parseChoreTagsJson(existing.tagsJson);
      patch.tagsJson = serializeChoreTagsJson(
        body.list !== undefined ? body.list : current.list,
        body.tags ?? current.tags,
      );
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
      list?: string | null;
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
        tagsJson: serializeChoreTagsJson(body.list, body.tags ?? []),
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
      list?: string | null;
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
      list: body.list,
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
      list?: string | null;
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
    if (body.list !== undefined || body.tags !== undefined) {
      const current = parseChoreTagsJson(existing.tagsJson);
      patch.tagsJson = serializeChoreTagsJson(
        body.list !== undefined ? body.list : current.list,
        body.tags ?? current.tags,
      );
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

  app.get("/notes/tag-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectNoteTagSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/notes", async (c) => {
    const auth = c.get("auth")!;
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const q = c.req.query("q")?.trim();
    const tag = c.req.query("tag")?.trim();
    const rows = await db
      .select()
      .from(notes)
      .where(noteListWhere(db, auth, q, tag))
      .orderBy(desc(notes.pinned), desc(notes.createdAt))
      .limit(50);
    const shareMap = await loadNoteShareMap(
      db,
      rows.filter((r) => r.visibility === "private").map((r) => r.id),
    );
    const attachmentMap = driveEnabled
      ? await loadEntityDriveAttachments(
          db,
          auth,
          "note",
          rows.map((r) => r.id),
        )
      : undefined;
    const embedIds = driveEnabled
      ? [...new Set(rows.flatMap((row) => parseDriveEmbedIds(row.content)))]
      : [];
    const driveEmbedMap =
      driveEnabled && embedIds.length > 0
        ? await loadDriveEmbedObjects(db, auth, embedIds)
        : undefined;
    return c.json({
      notes: rows.map((row) =>
        serializeNote(row, auth, shareMap, attachmentMap, driveEmbedMap, driveEnabled),
      ),
    });
  });

  app.post("/notes", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      content: string;
      pinned?: boolean;
      tags?: string[];
      visibility?: NoteVisibility;
      sharedMemberIds?: string[];
    }>();
    const title = normalizeNoteTitle(body.title);
    if (!title) return c.json({ error: "title_required" }, 400);
    const content = body.content?.trim();
    if (!content) return c.json({ error: "content_required" }, 400);
    const visibility = normalizeNoteVisibility(body.visibility);
    const [row] = await db
      .insert(notes)
      .values({
        householdId: auth.householdId,
        title,
        content,
        pinned: Boolean(body.pinned),
        tagsJson: serializeNoteTagsJson(body.tags ?? []),
        visibility,
        createdByUserId: auth.userId,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    let sharedMemberIds: string[] = [];
    if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
      sharedMemberIds = await validateShareMemberIds(
        db,
        auth.householdId,
        body.sharedMemberIds,
        auth.memberId,
      );
      await replaceNoteShares(db, row.id, sharedMemberIds);
    }
    const shareMap = new Map<string, string[]>([[row.id, sharedMemberIds]]);
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const embedIds = driveEnabled ? parseDriveEmbedIds(row.content) : [];
    const driveEmbedMap =
      driveEnabled && embedIds.length > 0
        ? await loadDriveEmbedObjects(db, auth, embedIds)
        : undefined;
    return c.json(
      { note: serializeNote(row, auth, shareMap, undefined, driveEmbedMap, driveEnabled) },
      201,
    );
  });

  app.patch("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      content?: string;
      pinned?: boolean;
      tags?: string[];
      visibility?: NoteVisibility;
      sharedMemberIds?: string[];
    }>();
    const patch: Partial<typeof notes.$inferInsert> = {};
    if (body.title !== undefined) {
      const title = normalizeNoteTitle(body.title);
      if (!title) return c.json({ error: "title_required" }, 400);
      patch.title = title;
    }
    if (body.content !== undefined) {
      const content = body.content.trim();
      if (!content) return c.json({ error: "content_required" }, 400);
      patch.content = content;
    }
    if (body.pinned !== undefined) {
      patch.pinned = Boolean(body.pinned);
    }
    if (body.tags !== undefined) {
      patch.tagsJson = serializeNoteTagsJson(body.tags);
    }
    if (body.visibility !== undefined) {
      const visibility = normalizeNoteVisibility(body.visibility);
      patch.visibility = visibility;
      if (visibility === "private") {
        patch.createdByUserId = auth.userId;
      }
    }
    const hasShareUpdate = body.sharedMemberIds !== undefined;
    if (Object.keys(patch).length === 0 && !hasShareUpdate) {
      return c.json({ error: "no_changes" }, 400);
    }
    const [row] =
      Object.keys(patch).length > 0
        ? await db
            .update(notes)
            .set(patch)
            .where(noteMutableWhere(id, auth))
            .returning()
        : await db
            .select()
            .from(notes)
            .where(noteMutableWhere(id, auth))
            .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.visibility === "household") {
      await replaceNoteShares(db, row.id, []);
    } else if (hasShareUpdate) {
      const sharedMemberIds = await validateShareMemberIds(
        db,
        auth.householdId,
        body.sharedMemberIds ?? [],
        auth.memberId,
      );
      await replaceNoteShares(db, row.id, sharedMemberIds);
    }
    const shareMap = await loadNoteShareMap(db, row.visibility === "private" ? [row.id] : []);
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const embedIds = driveEnabled ? parseDriveEmbedIds(row.content) : [];
    const driveEmbedMap =
      driveEnabled && embedIds.length > 0
        ? await loadDriveEmbedObjects(db, auth, embedIds)
        : undefined;
    return c.json({
      note: serializeNote(row, auth, shareMap, undefined, driveEmbedMap, driveEnabled),
    });
  });

  app.delete("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .delete(notes)
      .where(noteMutableWhere(id, auth))
      .returning({ id: notes.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/expenses/category-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectExpenseCategorySuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/expenses/reports", async (c) => {
    const auth = c.get("auth")!;
    const monthQuery = c.req.query("month")?.trim();
    if (monthQuery && !normalizeMonthKey(monthQuery)) {
      return c.json({ error: "invalid_month" }, 400);
    }
    const scope =
      c.req.query("scope")?.trim() === "personal" ? ("personal" as const) : ("household" as const);
    const report = await buildExpenseReports(db, auth.householdId, monthQuery, {
      scope,
      memberId: scope === "personal" ? auth.memberId : undefined,
    });
    return c.json(report);
  });

  app.get("/expenses/budgets", async (c) => {
    const auth = c.get("auth")!;
    const visible = await listVisibleBudgets(db, auth);
    const monthKey = currentMonthKey();
    const budgets = [];
    for (const budget of visible) {
      const shares =
        budget.memberId && isBudgetOwner(auth, budget)
          ? await loadBudgetShareRows(db, budget.id)
          : budget.shareAccess
            ? await loadBudgetShareRows(db, budget.id).then((rows) =>
                rows.filter((r) => r.memberId === auth.memberId),
              )
            : [];
      budgets.push(
        await summarizeBudgetRow(db, budget, monthKey, {
          shareAccess: budget.shareAccess,
          shares,
        }),
      );
    }
    return c.json({ budgets });
  });

  app.post("/expenses/budgets", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      category?: string;
      monthlyTarget?: number;
      scope?: string;
    }>();
    const category = normalizeExpenseCategory(body.category);
    const monthlyTarget = Number(body.monthlyTarget);
    const personal = body.scope === "personal";
    if (!category || Number.isNaN(monthlyTarget) || monthlyTarget <= 0) {
      return c.json({ error: "invalid_budget" }, 400);
    }
    try {
      const [row] = await db
        .insert(expenseBudgets)
        .values({
          householdId: auth.householdId,
          category,
          monthlyTarget,
          memberId: personal ? auth.memberId : null,
        })
        .returning();
      const budget = await summarizeBudgetRow(db, row, currentMonthKey(), {
        shareAccess: null,
        shares: [],
      });
      return c.json({ budget }, 201);
    } catch {
      return c.json({ error: "duplicate_category" }, 409);
    }
  });

  app.patch("/expenses/budgets/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ monthlyTarget?: number }>();
    const monthlyTarget = Number(body.monthlyTarget);
    if (Number.isNaN(monthlyTarget) || monthlyTarget <= 0) {
      return c.json({ error: "invalid_budget" }, 400);
    }
    const [existing] = await db
      .select()
      .from(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const visible = await listVisibleBudgets(db, auth);
    const access = visible.find((b) => b.id === id);
    if (!access || !canWriteBudget(auth, existing, access.shareAccess)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [row] = await db
      .update(expenseBudgets)
      .set({ monthlyTarget })
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    const shares = await loadBudgetShareRows(db, row.id);
    const budget = await summarizeBudgetRow(db, row, currentMonthKey(), {
      shareAccess: access.shareAccess,
      shares: isBudgetOwner(auth, row) ? shares : shares.filter((s) => s.memberId === auth.memberId),
    });
    return c.json({ budget });
  });

  app.delete("/expenses/budgets/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const visible = await listVisibleBudgets(db, auth);
    const access = visible.find((b) => b.id === id);
    if (!access || !canWriteBudget(auth, existing, access.shareAccess)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [row] = await db
      .delete(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .returning({ id: expenseBudgets.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.put("/expenses/budgets/:id/shares", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!existing.memberId || !isBudgetOwner(auth, existing)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      shares?: { memberId?: string; access?: string }[];
    }>();
    const shares: { memberId: string; access: ExpenseBudgetShareAccess }[] = [];
    for (const raw of body.shares ?? []) {
      if (!raw.memberId || (raw.access !== "read" && raw.access !== "write")) {
        return c.json({ error: "invalid_shares" }, 400);
      }
      shares.push({ memberId: raw.memberId, access: raw.access });
    }
    if (
      !(await validateBudgetShareMemberIds(
        db,
        auth.householdId,
        existing.memberId,
        shares.map((s) => s.memberId),
      ))
    ) {
      return c.json({ error: "invalid_shares" }, 400);
    }
    await replaceExpenseBudgetShares(db, id, shares);
    return c.json({ shares: await loadBudgetShareRows(db, id) });
  });

  app.get("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.householdId, auth.householdId))
      .orderBy(desc(expenses.expenseDate))
      .limit(200);
    return c.json({ expenses: rows.map(serializeExpense) });
  });

  app.post("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      amount: number;
      category?: string;
      expenseDate: string;
      memberId?: string | null;
    }>();
    const title = body.title?.trim();
    const amount = Number(body.amount);
    if (!title || Number.isNaN(amount) || amount < 0) {
      return c.json({ error: "invalid_expense" }, 400);
    }
    let memberId: string | null = auth.memberId;
    if (body.memberId === null) {
      memberId = null;
    } else if (typeof body.memberId === "string") {
      const [member] = await db
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.id, body.memberId),
            eq(householdMembers.householdId, auth.householdId),
          ),
        )
        .limit(1);
      if (!member) return c.json({ error: "invalid_member" }, 400);
      memberId = member.id;
    }
    const [row] = await db
      .insert(expenses)
      .values({
        householdId: auth.householdId,
        title,
        amount,
        category: normalizeExpenseCategory(body.category),
        expenseDate: body.expenseDate,
        memberId,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    void checkHouseholdBudgetAlerts(db, env, auth.householdId).catch(() => {});
    return c.json({ expense: serializeExpense(row) }, 201);
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

  app.patch("/expenses/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      amount?: number;
      category?: string | null;
      expenseDate?: string;
      memberId?: string | null;
    }>();
    const patch: {
      title?: string;
      amount?: number;
      category?: string | null;
      expenseDate?: string;
      memberId?: string | null;
    } = {};
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) return c.json({ error: "invalid_expense" }, 400);
      patch.title = title;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (Number.isNaN(amount) || amount < 0) return c.json({ error: "invalid_expense" }, 400);
      patch.amount = amount;
    }
    if (body.category !== undefined) {
      patch.category = normalizeExpenseCategory(body.category);
    }
    if (body.expenseDate !== undefined) patch.expenseDate = body.expenseDate;
    if (body.memberId === null) {
      patch.memberId = null;
    } else if (typeof body.memberId === "string") {
      const [member] = await db
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.id, body.memberId),
            eq(householdMembers.householdId, auth.householdId),
          ),
        )
        .limit(1);
      if (!member) return c.json({ error: "invalid_member" }, 400);
      patch.memberId = member.id;
    }

    const [row] = await db
      .update(expenses)
      .set(patch)
      .where(and(eq(expenses.id, id), eq(expenses.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    void checkHouseholdBudgetAlerts(db, env, auth.householdId).catch(() => {});
    return c.json({ expense: serializeExpense(row) });
  });

  app.delete("/expenses/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.householdId, auth.householdId)))
      .returning({ id: expenses.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  function parseModulesEnabled(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((m): m is string => typeof m === "string" && m.length > 0);
      }
    } catch {
      /* */
    }
    return [];
  }

  function normalizeModulesEnabledSelection(
    requested: string[] | undefined,
    modulesEntitled: string[] | null,
  ): string[] | null {
    return normalizeHouseholdModulesSelection(
      requested,
      householdModuleCeiling(env, modulesEntitled),
    );
  }

  function serializeHouseholdSettings(
    row: {
      name: string;
      slug: string | null;
      timezone: string;
      modulesEnabled: string;
      drivePermissionsJson?: string | null;
      storageQuotaBytes?: number | null;
      storageUsedBytes?: number;
    },
    modulesEntitled: string[] | null,
  ) {
    const modulesEnabled = parseModulesEnabled(row.modulesEnabled);
    const driveEnabled = modulesEnabled.includes("drive");
    return {
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      modulesEnabled,
      modulesEntitled,
      availableModules: householdModuleCeiling(env, modulesEntitled),
      drivePermissions: parseDrivePermissionsJson(row.drivePermissionsJson),
      drivePermissionDefaults: DEFAULT_DRIVE_ROLE_PERMISSIONS,
      driveStorage:
        driveEnabled && row.storageUsedBytes != null
          ? {
              usedBytes: row.storageUsedBytes,
              quotaBytes: row.storageQuotaBytes ?? null,
            }
          : null,
      drivePublicSharesEnabled: env.DRIVE_PUBLIC_SHARES_ENABLED,
    };
  }

  function normalizeHouseholdSlug(value: string | null | undefined): string | null {
    if (value == null || !value.trim()) return null;
    const slug = value.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
      return null;
    }
    return slug;
  }

  app.get("/household/settings", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .select({
        name: households.name,
        slug: households.slug,
        timezone: households.timezone,
        modulesEnabled: households.modulesEnabled,
        drivePermissionsJson: households.drivePermissionsJson,
        storageQuotaBytes: households.storageQuotaBytes,
        storageUsedBytes: households.storageUsedBytes,
      })
      .from(households)
      .where(eq(households.id, auth.householdId))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const { modulesEntitled } = await getHouseholdModuleContext(db, auth.householdId);
    return c.json(serializeHouseholdSettings(row, modulesEntitled));
  });

  app.patch("/household/settings", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{
      name?: string;
      slug?: string | null;
      timezone?: string;
      modulesEnabled?: string[];
      drivePermissions?: DriveRolePermissions;
    }>();

    const patch: {
      name?: string;
      slug?: string | null;
      timezone?: string;
      modulesEnabled?: string;
      drivePermissionsJson?: string;
      updatedAt?: Date;
    } = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return c.json({ error: "name_required" }, 400);
      patch.name = name.slice(0, 128);
    }
    if (body.slug !== undefined) {
      const slug = normalizeHouseholdSlug(body.slug);
      if (body.slug && body.slug.trim() && !slug) {
        return c.json({ error: "invalid_slug" }, 400);
      }
      patch.slug = slug;
    }
    if (body.timezone !== undefined) {
      const timezone = body.timezone.trim();
      if (!timezone || timezone.length > 64) {
        return c.json({ error: "invalid_timezone" }, 400);
      }
      patch.timezone = timezone;
    }
    if (body.modulesEnabled !== undefined) {
      const { modulesEntitled } = await getHouseholdModuleContext(db, auth.householdId);
      const modulesEnabled = normalizeModulesEnabledSelection(body.modulesEnabled, modulesEntitled);
      if (!modulesEnabled) {
        return c.json({ error: "invalid_modules" }, 400);
      }
      patch.modulesEnabled = JSON.stringify(modulesEnabled);
    }
    if (body.drivePermissions !== undefined) {
      const current = parseDrivePermissionsJson(
        (
          await db
            .select({ drivePermissionsJson: households.drivePermissionsJson })
            .from(households)
            .where(eq(households.id, auth.householdId))
            .limit(1)
        )[0]?.drivePermissionsJson,
      );
      const delta = normalizeDrivePermissionsPatch(body.drivePermissions);
      if (!delta) return c.json({ error: "invalid_drive_permissions" }, 400);
      patch.drivePermissionsJson = serializeDrivePermissionsJson({ ...current, ...delta });
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "no_changes" }, 400);
    }

    patch.updatedAt = new Date();
    const [row] = await db
      .update(households)
      .set(patch)
      .where(eq(households.id, auth.householdId))
      .returning({
        name: households.name,
        slug: households.slug,
        timezone: households.timezone,
        modulesEnabled: households.modulesEnabled,
        drivePermissionsJson: households.drivePermissionsJson,
        storageQuotaBytes: households.storageQuotaBytes,
        storageUsedBytes: households.storageUsedBytes,
      });
    if (!row) return c.json({ error: "not_found" }, 404);
    const { modulesEntitled } = await getHouseholdModuleContext(db, auth.householdId);
    return c.json({ ok: true, household: serializeHouseholdSettings(row, modulesEntitled) });
  });

  app.get("/household/integrations", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const googleOAuthConfigured = Boolean(
      env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET,
    );
    const calendarModuleEnabled = isModuleEnabled(env, "calendar_sync");

    let householdConnections = 0;
    let activeSyncRuns = 0;
    let lastSyncAt: string | null = null;

    if (calendarModuleEnabled) {
      const rows = await db
        .select({
          lastSyncAt: calendarConnections.lastSyncAt,
          syncRunStatus: calendarConnections.syncRunStatus,
        })
        .from(calendarConnections)
        .where(eq(calendarConnections.householdId, auth.householdId));
      householdConnections = rows.length;
      for (const row of rows) {
        if (
          row.lastSyncAt &&
          (!lastSyncAt || row.lastSyncAt.getTime() > new Date(lastSyncAt).getTime())
        ) {
          lastSyncAt = row.lastSyncAt.toISOString();
        }
        if (row.syncRunStatus === "queued" || row.syncRunStatus === "syncing") {
          activeSyncRuns += 1;
        }
      }
    }

    return c.json({
      googleLogin: { configured: googleOAuthConfigured },
      calendarSync: {
        moduleEnabled: calendarModuleEnabled,
        oauthConfigured: googleOAuthConfigured,
        defaultSyncMode: env.GOOGLE_CALENDAR_DEFAULT_SYNC_MODE,
        householdConnections,
        activeSyncRuns,
        lastSyncAt,
      },
      webPush: { configured: isWebPushConfigured(env) },
      storage: {
        configured: Boolean(createS3Client(env) && env.S3_BUCKET),
        bucket: env.S3_BUCKET ?? null,
      },
    });
  });

  app.get("/household/roster", async (c) => {
    const auth = c.get("auth")!;
    const rows = await listHouseholdMembersWithAuth(db, auth.householdId);
    return c.json({
      members: rows.map((m) => ({
        memberId: m.memberId,
        label: memberShownLabel({ name: m.name }) || m.username || m.email || "Member",
      })),
    });
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

  app.patch("/household/members/:memberId/role", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const memberId = c.req.param("memberId");
    const body = await c.req.json<{ role?: string }>();
    if (!body.role || !isHouseholdMemberRole(body.role)) {
      return c.json({ error: "invalid_role" }, 400);
    }
    try {
      const updated = await updateHouseholdMemberRole(db, {
        householdId: auth.householdId,
        actorRole: auth.role,
        targetMemberId: memberId,
        role: body.role,
      });
      return c.json({ ok: true, member: updated });
    } catch (e) {
      if (e instanceof UpdateMemberRoleError) {
        const status =
          e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 400;
        return c.json({ error: e.code, message: e.message }, status);
      }
      throw e;
    }
  });

  return app;
}
