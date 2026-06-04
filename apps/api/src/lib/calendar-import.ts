import type { Database } from "@whome/db";
import { calendars } from "@whome/db";
import { and, eq } from "drizzle-orm";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHexColor(
  input: string | null | undefined,
  fallback = "#3b82f6",
): string {
  const raw = (input ?? "").trim();
  if (!raw) return fallback;
  if (HEX_RE.test(raw)) {
    if (raw.length === 4) {
      const r = raw[1];
      const g = raw[2];
      const b = raw[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return raw.toLowerCase();
  }
  return fallback;
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

export async function resolveTargetCalendar(
  db: Database,
  opts: {
    householdId: string;
    ownerUserId: string;
    targetCalendarId?: string | null;
    newCalendarName?: string | null;
    fallbackName?: string | null;
    newCalendarColor?: string | null;
    fallbackColor?: string | null;
  },
): Promise<string> {
  const color = normalizeHexColor(
    opts.newCalendarColor ?? opts.fallbackColor,
    "#3b82f6",
  );

  if (opts.targetCalendarId) {
    const [existing] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(
        and(
          eq(calendars.id, opts.targetCalendarId),
          eq(calendars.householdId, opts.householdId),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
  }

  const name =
    (opts.newCalendarName ?? "").trim() ||
    (opts.fallbackName ?? "").trim() ||
    "Google calendar";
  if (name) {
    const rows = await db
      .select()
      .from(calendars)
      .where(eq(calendars.householdId, opts.householdId));
    const match = rows.find((c) => normalizedName(c.name) === normalizedName(name));
    if (match) return match.id;

    const [created] = await db
      .insert(calendars)
      .values({
        householdId: opts.householdId,
        ownerUserId: opts.ownerUserId,
        name: name.slice(0, 128),
        color,
        visibility: "private",
      })
      .returning();
    return created.id;
  }

  throw new Error("target_calendar_required");
}
