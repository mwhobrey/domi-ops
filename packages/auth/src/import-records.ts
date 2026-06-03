import type { Database } from "@whome/db";
import { importRecords } from "@whome/db";

export async function hasImportRecords(db: Database): Promise<boolean> {
  const [row] = await db.select({ id: importRecords.id }).from(importRecords).limit(1);
  return Boolean(row);
}

/** Household that received the HomeHub import (first import_records row). */
export async function getImportedHouseholdId(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ householdId: importRecords.householdId })
    .from(importRecords)
    .limit(1);
  return row?.householdId ?? null;
}
