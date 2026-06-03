import { requireDb } from "../lib/require-db.js";
import { households, importRecords } from "@whome/db";
import { eq } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

const IMPORT_MARKER_SOURCE = "whome";
const IMPORT_MARKER_ID = "household";

export async function importHousehold(
  ctx: ImportContext,
  householdName: string,
): Promise<{ householdId: string; result: MapperResult }> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };

  if (ctx.dryRun) {
    result.imported = 1;
    result.warnings.push("dry-run: would create household (members join on Google login)");
    return { householdId: "00000000-0000-0000-0000-000000000000", result };
  }

  const db = requireDb(ctx);
  if (!db) throw new Error("ImportContext.db required for live import");

  const [existingImport] = await db.select().from(importRecords).limit(1);

  if (existingImport) {
    result.skipped = 1;
    result.warnings.push(`reusing household ${existingImport.householdId} from prior import`);
    return { householdId: existingImport.householdId, result };
  }

  const [household] = await db
    .insert(households)
    .values({ name: householdName, tier: "self_host" })
    .returning();

  await db.insert(importRecords).values({
    householdId: household.id,
    sourceTable: IMPORT_MARKER_SOURCE,
    sourceId: IMPORT_MARKER_ID,
    targetTable: "households",
    targetId: household.id,
  });

  result.imported = 1;
  result.warnings.push(
    "home_status nicknames not imported — members set nicknames in profile after Google login",
  );

  return { householdId: household.id, result };
}
