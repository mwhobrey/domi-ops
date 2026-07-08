import { loadRootDotenv } from "@domi-ops/config";
import { requireDb } from "../lib/require-db.js";
import {
  IMPORT_MARKER_ID,
  IMPORT_MARKER_SOURCE,
  IMPORT_MARKER_SOURCES,
} from "../lib/import-marker.js";
import { households, importRecords } from "@domi-ops/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

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
    .where(
      and(
        inArray(importRecords.sourceTable, [...IMPORT_MARKER_SOURCES]),
        eq(importRecords.sourceId, IMPORT_MARKER_ID),
      ),
    )
    .limit(1);

  if (existingImport) {
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
