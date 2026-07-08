import type { Database } from "@domi-ops/db";
import { calendars, calendarEvents, calendarEventReminders, importRecords, recurringRules } from "@domi-ops/db";
import { eq, and } from "drizzle-orm";
import { sqliteTableExists, sqliteSelectExisting, sqliteColumns } from "../lib/sqlite.js";
import { requireDb } from "../lib/require-db.js";
import { lookupImportedTarget, rememberImportedTarget } from "../lib/import-record-index.js";
import type { ImportContext, MapperResult } from "./types.js";

import { REMINDER_OFFSET_COLUMNS, reminderOffsetsFromHomeHubRow } from "./calendar-reminder-import.js";
async function insertImportedEventReminders(
  db: Database,
  eventId: string,
  householdId: string,
  offsets: number[],
): Promise<void> {
  if (offsets.length === 0) return;
  await db.insert(calendarEventReminders).values(
    offsets.map((offsetMinutes) => ({
      eventId,
      householdId,
      offsetMinutes,
      enabled: true,
    })),
  );
}

export async function importCalendar(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  if (!sqliteTableExists(ctx.sqlite, "reminder")) {
    result.warnings.push("reminder table not found — skipped");
    return result;
  }
  const reminders = sqliteSelectExisting(
    ctx.sqlite,
    "reminder",
    [
      "id",
      "date",
      "time",
      "title",
      "description",
      "category",
      "color",
      "all_day",
      "end_date",
      "end_time",
      "source",
      "google_event_id",
      "personal_calendar_id",
      ...REMINDER_OFFSET_COLUMNS,
    ],
    " LIMIT 5000",
  );
  const reminderColumns = sqliteColumns(ctx.sqlite, "reminder");

  if (ctx.dryRun) {
    result.imported = reminders.length;
    let pcCount = 0;
    try {
      const pc = ctx.sqlite
        .prepare("SELECT COUNT(*) as c FROM personal_calendar")
        .get() as { c: number };
      pcCount = pc?.c ?? 0;
    } catch {
      /* optional table */
    }
    result.warnings.push(`dry-run: ${reminders.length} reminders, ${pcCount} personal calendars`);
    return result;
  }

  const db = requireDb(ctx);
  const householdBucketSourceId = "imported_homehub";
  let calendarId = ctx.idMap.get(`household_calendar:${householdBucketSourceId}`);
  if (!calendarId) {
    const existingTarget = await lookupImportedTarget(
      db,
      ctx.importRecordIndex,
      ctx.householdId,
      "household_calendar",
      householdBucketSourceId,
    );
    if (existingTarget) {
      calendarId = existingTarget;
    } else {
      const [cal] = await db
        .insert(calendars)
        .values({
          householdId: ctx.householdId,
          name: "Imported from HomeHub",
          visibility: "household",
          isHouseholdDefault: true,
        })
        .returning();
      calendarId = cal.id;
      await db.insert(importRecords).values({
        householdId: ctx.householdId,
        sourceTable: "household_calendar",
        sourceId: householdBucketSourceId,
        targetTable: "calendars",
        targetId: cal.id,
      });
      rememberImportedTarget(
        ctx.importRecordIndex,
        "household_calendar",
        householdBucketSourceId,
        cal.id,
      );
    }
    ctx.idMap.set(`household_calendar:${householdBucketSourceId}`, calendarId);
  }

  if (sqliteTableExists(ctx.sqlite, "personal_calendar")) {
    const pcs = ctx.sqlite
      .prepare("SELECT id, name, color, visibility FROM personal_calendar ORDER BY id")
      .all() as Record<string, unknown>[];
    for (const pc of pcs) {
      const sourceId = String(pc.id);
      if (ctx.idMap.has(`personal_calendar:${sourceId}`)) continue;
      const existingTarget = await lookupImportedTarget(
        db,
        ctx.importRecordIndex,
        ctx.householdId,
        "personal_calendar",
        sourceId,
      );
      if (existingTarget) {
        ctx.idMap.set(`personal_calendar:${sourceId}`, existingTarget);
        continue;
      }
      const [cal] = await db
        .insert(calendars)
        .values({
          householdId: ctx.householdId,
          name: String(pc.name ?? "Calendar").slice(0, 128),
          color: pc.color ? String(pc.color).slice(0, 16) : null,
          visibility: pc.visibility === "household" ? "household" : "private",
        })
        .returning();
      ctx.idMap.set(`personal_calendar:${sourceId}`, cal.id);
      await db.insert(importRecords).values({
        householdId: ctx.householdId,
        sourceTable: "personal_calendar",
        sourceId,
        targetTable: "calendars",
        targetId: cal.id,
      });
      rememberImportedTarget(ctx.importRecordIndex, "personal_calendar", sourceId, cal.id);
      result.imported++;
    }
  }

  const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
  function homeHubFreqToRrule(freq: string, startDate: string): string {
    const f = freq.trim().toLowerCase();
    if (f === "daily") return "FREQ=DAILY;INTERVAL=1";
    if (f === "monthly") return "FREQ=MONTHLY;INTERVAL=1";
    const dow = new Date(`${startDate}T12:00:00`).getDay();
    return `FREQ=WEEKLY;BYDAY=${WEEKDAY[dow]}`;
  }

  if (sqliteTableExists(ctx.sqlite, "recurring_reminder")) {
    const recurring = sqliteSelectExisting(ctx.sqlite, "recurring_reminder", [
      "id",
      "title",
      "description",
      "category",
      "color",
      "frequency",
      "interval",
      "start_date",
      "end_date",
      "time",
      "end_time",
      "all_day",
      "personal_calendar_id",
    ]);
    for (const row of recurring) {
      const sourceId = String(row.id);
      if (ctx.idMap.has(`recurring_reminder:${sourceId}`)) continue;
      const existingTarget = await lookupImportedTarget(
        db,
        ctx.importRecordIndex,
        ctx.householdId,
        "recurring_reminder",
        sourceId,
      );
      if (existingTarget) {
        ctx.idMap.set(`recurring_reminder:${sourceId}`, existingTarget);
        continue;
      }
      const startDate = String(row.start_date ?? "").slice(0, 10);
      if (!startDate) continue;
      const pcId = row.personal_calendar_id
        ? ctx.idMap.get(`personal_calendar:${row.personal_calendar_id}`)
        : undefined;
      const targetCalendarId = pcId ?? calendarId!;
      const allDay = Boolean(row.all_day);
      const freq = String(row.frequency ?? "weekly");
      const [rule] = await db
        .insert(recurringRules)
        .values({
          householdId: ctx.householdId,
          calendarId: targetCalendarId,
          title: String(row.title ?? "Untitled").slice(0, 256),
          description: row.description ? String(row.description) : null,
          rrule: homeHubFreqToRrule(freq, startDate),
          startDate,
          endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
          startTime: allDay ? null : row.time ? String(row.time) : null,
          endTime: allDay ? null : row.end_time ? String(row.end_time) : null,
          allDay,
          categoryKey: row.category ? String(row.category) : null,
          color: row.color ? String(row.color) : null,
        })
        .returning();
      await db.insert(calendarEvents).values({
        householdId: ctx.householdId,
        calendarId: targetCalendarId,
        title: String(row.title ?? "Untitled").slice(0, 256),
        description: row.description ? String(row.description) : null,
        startDate,
        endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
        startTime: allDay ? null : row.time ? String(row.time) : null,
        endTime: allDay ? null : row.end_time ? String(row.end_time) : null,
        allDay,
        categoryKey: row.category ? String(row.category) : null,
        color: row.color ? String(row.color) : null,
        source: "local",
        recurringRuleId: rule!.id,
      });
      await db.insert(importRecords).values({
        householdId: ctx.householdId,
        sourceTable: "recurring_reminder",
        sourceId,
        targetTable: "recurring_rules",
        targetId: rule!.id,
      });
      rememberImportedTarget(ctx.importRecordIndex, "recurring_reminder", sourceId, rule!.id);
      ctx.idMap.set(`recurring_reminder:${sourceId}`, rule!.id);
      result.imported += 1;
    }
  }

  for (const r of reminders) {
    const sourceId = String(r.id);
    const existingTarget = await lookupImportedTarget(
      db,
      ctx.importRecordIndex,
      ctx.householdId,
      "reminder",
      sourceId,
    );
    if (existingTarget) {
      result.skipped++;
      continue;
    }
    const googleEventId = r.google_event_id ? String(r.google_event_id) : null;
    if (googleEventId) {
      const [dup] = await db
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.householdId, ctx.householdId),
            eq(calendarEvents.googleEventId, googleEventId),
          ),
        )
        .limit(1);
      if (dup) {
        await db.insert(importRecords).values({
          householdId: ctx.householdId,
          sourceTable: "reminder",
          sourceId,
          targetTable: "calendar_events",
          targetId: dup.id,
        });
        rememberImportedTarget(ctx.importRecordIndex, "reminder", sourceId, dup.id);
        result.skipped++;
        continue;
      }
    }
    const startDate = String(r.date).slice(0, 10);
    const pcId = r.personal_calendar_id
      ? ctx.idMap.get(`personal_calendar:${r.personal_calendar_id}`)
      : undefined;
    const targetCalendarId = pcId ?? calendarId!;
    const [ev] = await db
      .insert(calendarEvents)
      .values({
        householdId: ctx.householdId,
        calendarId: targetCalendarId,
        title: String(r.title ?? "Untitled").slice(0, 256),
        description: r.description ? String(r.description) : null,
        startDate,
        endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
        startTime: r.time ? String(r.time) : null,
        endTime: r.end_time ? String(r.end_time) : null,
        allDay: Boolean(r.all_day),
        categoryKey: r.category ? String(r.category) : null,
        color: r.color ? String(r.color) : null,
        source: r.source === "google" ? "google" : "local",
        googleEventId,
      })
      .returning();
    const importOffsets = reminderOffsetsFromHomeHubRow(r, reminderColumns);
    if (importOffsets.length > 0) {
      await insertImportedEventReminders(db, ev.id, ctx.householdId, importOffsets);
    }
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "reminder",
      sourceId,
      targetTable: "calendar_events",
      targetId: ev.id,
    });
    rememberImportedTarget(ctx.importRecordIndex, "reminder", sourceId, ev.id);
    result.imported++;
  }
  return result;
}
