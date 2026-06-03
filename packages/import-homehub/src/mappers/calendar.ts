import { createDb } from "@whome/db";
import { calendars, calendarEvents, importRecords } from "@whome/db";
import { eq, and } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

export async function importCalendar(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  const reminders = ctx.sqlite
    .prepare(
      `SELECT id, date, time, title, description, category, color, all_day, end_date, end_time,
              source, google_event_id, personal_calendar_id
       FROM reminder LIMIT 5000`,
    )
    .all() as Record<string, unknown>[];

  if (ctx.dryRun) {
    result.imported = reminders.length;
    const pc = ctx.sqlite
      .prepare("SELECT COUNT(*) as c FROM personal_calendar")
      .get() as { c: number };
    result.warnings.push(`dry-run: ${reminders.length} reminders, ${pc?.c ?? 0} personal calendars`);
    return result;
  }

  const db = createDb(ctx.databaseUrl);
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
    const [ev] = await db
      .insert(calendarEvents)
      .values({
        householdId: ctx.householdId,
        calendarId: calendarId!,
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
