import type { Database } from "@domi-ops/db";
import { importRecords } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";

/** Persisted in import_records — legacy marker from whome era. */
const LEGACY_IMPORT_MARKER_SOURCE = "whome";
const IMPORT_MARKER_SOURCE = "domi-ops";
const IMPORT_MARKER_ID = "household";

const IMPORT_MARKER_SOURCES = [IMPORT_MARKER_SOURCE, LEGACY_IMPORT_MARKER_SOURCE] as const;

export async function hasImportRecords(db: Database): Promise<boolean> {
  const [row] = await db.select({ id: importRecords.id }).from(importRecords).limit(1);
  return Boolean(row);
}

/** Household that received the HomeHub import (`domi-ops` / `whome` + `household` marker). */
export async function getImportedHouseholdId(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ householdId: importRecords.householdId })
    .from(importRecords)
    .where(
      and(
        inArray(importRecords.sourceTable, [...IMPORT_MARKER_SOURCES]),
        eq(importRecords.sourceId, IMPORT_MARKER_ID),
      ),
    )
    .limit(1);
  return row?.householdId ?? null;
}
