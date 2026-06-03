import { calendars, calendarEvents, importRecords } from "@whome/db";
import { eq, and } from "drizzle-orm";
import { sqliteTableExists } from "../lib/sqlite.js";
import { requireDb } from "../lib/require-db.js";
import type { ImportContext, MapperResult } from "./types.js";

export async function importCalendar(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  if (!sqliteTableExists(ctx.sqlite, "reminder")) {
    result.warnings.push("reminder table not found — skipped");
    return result;
  }
  const reminders = ctx.sqlite
    .prepare(
      `SELECT id, date, time, title, description, category, color, all_day, end_date, end_time,
              source, google_event_id, personal_calendar_id
       FROM reminder LIMIT 5000`,
    )
    .all() as Record<string, unknown>[];

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
  const calKey = `household:${ctx.householdId}:imported`;
  let calendarId = ctx.idMap.get(calKey);
  if (!calendarId) {
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
    ctx.idMap.set(calKey, calendarId);
  }

  if (sqliteTableExists(ctx.sqlite, "personal_calendar")) {
    const pcs = ctx.sqlite
      .prepare("SELECT id, name, color, visibility FROM personal_calendar ORDER BY id")
      .all() as Record<string, unknown>[];
    for (const pc of pcs) {
      const sourceId = String(pc.id);
      if (ctx.idMap.has(`personal_calendar:${sourceId}`)) continue;
      const [existing] = await db
        .select()
        .from(importRecords)
        .where(
          and(
            eq(importRecords.householdId, ctx.householdId),
            eq(importRecords.sourceTable, "personal_calendar"),
            eq(importRecords.sourceId, sourceId),
          ),
        )
        .limit(1);
      if (existing) {
        ctx.idMap.set(`personal_calendar:${sourceId}`, existing.targetId);
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
      result.imported++;
    }
  }

  for (const r of reminders) {
    const sourceId = String(r.id);
    const [existing] = await db
      .select()
      .from(importRecords)
      .where(
        and(
          eq(importRecords.householdId, ctx.householdId),
          eq(importRecords.sourceTable, "reminder"),
          eq(importRecords.sourceId, sourceId),
        ),
      )
      .limit(1);
    if (existing) {
      result.skipped++;
      continue;
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
        googleEventId: r.google_event_id ? String(r.google_event_id) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "reminder",
      sourceId,
      targetTable: "calendar_events",
      targetId: ev.id,
    });
    result.imported++;
  }
  return result;
}
