import type { Database } from "@whome/db";
import { importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";

const IMPORT_MARKER_SOURCE = "whome";
const IMPORT_MARKER_ID = "household";

export async function hasImportRecords(db: Database): Promise<boolean> {
  const [row] = await db.select({ id: importRecords.id }).from(importRecords).limit(1);
  return Boolean(row);
}

/** Household that received the HomeHub import (`whome` / `household` marker). */
export async function getImportedHouseholdId(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ householdId: importRecords.householdId })
    .from(importRecords)
    .where(
      and(
        eq(importRecords.sourceTable, IMPORT_MARKER_SOURCE),
        eq(importRecords.sourceId, IMPORT_MARKER_ID),
      ),
    )
    .limit(1);
  return row?.householdId ?? null;
}
