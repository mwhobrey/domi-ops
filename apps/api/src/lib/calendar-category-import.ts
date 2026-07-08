import { normalizeCategorySourceKey } from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import { calendarCategoryImportMappings } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { slugCategoryKey } from "./calendar-event-categories.js";
import { normalizeHexColor } from "./calendar-import.js";

export type CategorySelection = {
  sourceKey: string;
  sourceLabel?: string;
  targetKey?: string;
  targetLabel?: string;
  targetColor?: string;
  enabled?: boolean;
};

export async function upsertCategoryMappings(
  db: Database,
  connectionId: string,
  linkedCalendarId: string,
  categories: CategorySelection[],
): Promise<number> {
  await db
    .delete(calendarCategoryImportMappings)
    .where(
      and(
        eq(calendarCategoryImportMappings.connectionId, connectionId),
        eq(calendarCategoryImportMappings.linkedCalendarId, linkedCalendarId),
      ),
    );

  const bySource = new Map<
    string,
    {
      sourceKey: string;
      sourceLabel: string;
      targetKey: string;
      targetLabel: string;
      targetColor: string | null;
    }
  >();

  for (const c of categories) {
    if (c.enabled === false) continue;
    const sourceKey = normalizeCategorySourceKey(c.sourceKey ?? "");
    if (!sourceKey) continue;
    const targetLabel = (c.targetLabel ?? "").trim();
    if (!targetLabel) continue;
    bySource.set(sourceKey, {
      sourceKey,
      sourceLabel: (c.sourceLabel ?? sourceKey).slice(0, 128),
      targetKey: (c.targetKey ?? slugCategoryKey(targetLabel)).slice(0, 64),
      targetLabel: targetLabel.slice(0, 128),
      targetColor: c.targetColor
        ? normalizeHexColor(c.targetColor, "#3b82f6")
        : null,
    });
  }

  let saved = 0;
  for (const row of bySource.values()) {
    await db.insert(calendarCategoryImportMappings).values({
      connectionId,
      linkedCalendarId,
      ...row,
    });
    saved += 1;
  }
  return saved;
}
