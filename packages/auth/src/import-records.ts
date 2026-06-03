import type { Database } from "@whome/db";
import { importRecords } from "@whome/db";

export async function hasImportRecords(db: Database): Promise<boolean> {
  const [row] = await db.select({ id: importRecords.id }).from(importRecords).limit(1);
  return Boolean(row);
}
