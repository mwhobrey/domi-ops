import { loadRootDotenv } from "@whome/config";
import { requireDb } from "../lib/require-db.js";
import { households, importRecords } from "@whome/db";
import { asc, eq } from "drizzle-orm";
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
    result.warnings.push("dry-run: would create household + home_status stub members");
    return { householdId: "00000000-0000-0000-0000-000000000000", result };
  }

  const db = requireDb(ctx);
  if (!db) throw new Error("ImportContext.db required for live import");

  const [existingImport] = await db
    .select()
    .from(importRecords)
    .where(eq(importRecords.sourceTable, IMPORT_MARKER_SOURCE))
    .limit(1);

  if (existingImport?.sourceId === IMPORT_MARKER_ID) {
    result.skipped = 1;
    result.warnings.push(`reusing household ${existingImport.householdId} from prior import`);
    return { householdId: existingImport.householdId, result };
  }

  loadRootDotenv();
  const singleTenant = process.env.DEPLOYMENT_MODE !== "shared";
  if (singleTenant) {
    const [canonical] = await db
      .select({ id: households.id, name: households.name })
      .from(households)
      .orderBy(asc(households.createdAt))
      .limit(1);
    if (canonical) {
      await db.insert(importRecords).values({
        householdId: canonical.id,
        sourceTable: IMPORT_MARKER_SOURCE,
        sourceId: IMPORT_MARKER_ID,
        targetTable: "households",
        targetId: canonical.id,
      });
      result.skipped = 1;
      result.warnings.push(
        `single-tenant: importing into canonical household ${canonical.id} (${canonical.name})`,
      );
      return { householdId: canonical.id, result };
    }
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

  return { householdId: household.id, result };
}
