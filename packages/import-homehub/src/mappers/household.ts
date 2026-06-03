import { requireDb } from "../lib/require-db.js";
import { homeStatus, households, householdMembers, users } from "@whome/db";
import { importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

export async function importHousehold(
  ctx: ImportContext,
  householdName: string,
): Promise<{ householdId: string; result: MapperResult }> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };

  if (ctx.dryRun) {
    const homeRows = ctx.sqlite
      .prepare("SELECT COUNT(*) as c FROM home_status")
      .get() as { c: number };
    result.imported = homeRows?.c ?? 0;
    result.warnings.push("dry-run: would create household and map home_status rows");
    return { householdId: "00000000-0000-0000-0000-000000000000", result };
  }

  const db = requireDb(ctx);
  if (!db) throw new Error("ImportContext.db required for live import");

  const statusRows = ctx.sqlite
    .prepare("SELECT id, name, status FROM home_status")
    .all() as { id: number; name: string; status: string }[];

  if (statusRows.length > 0) {
    const [existingImport] = await db
      .select()
      .from(importRecords)
      .where(
        and(
          eq(importRecords.sourceTable, "home_status"),
          eq(importRecords.sourceId, String(statusRows[0].id)),
        ),
      )
      .limit(1);
    if (existingImport) {
      result.skipped = statusRows.length;
      result.warnings.push(`reusing household ${existingImport.householdId} from prior import`);
      return { householdId: existingImport.householdId, result };
    }
  }

  const [household] = await db
    .insert(households)
    .values({ name: householdName, tier: "self_host" })
    .returning();

  for (const row of statusRows) {
    const email = `${row.name.toLowerCase().replace(/\s+/g, ".")}@imported.local`;
    let userId: string;
    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const [u] = await db
        .insert(users)
        .values({ email, displayName: row.name, emailVerified: false })
        .returning();
      userId = u.id;
    }
    await db.insert(householdMembers).values({
      householdId: household.id,
      userId,
      role: "member",
      legacyDisplayName: row.name,
      legacyExternalId: String(row.id),
    });
    await db.insert(homeStatus).values({
      householdId: household.id,
      name: row.name,
      status: row.status ?? "Away",
    });
    await db.insert(importRecords).values({
      householdId: household.id,
      sourceTable: "home_status",
      sourceId: String(row.id),
      targetTable: "household_members",
      targetId: userId,
    });
    result.imported++;
  }

  return { householdId: household.id, result };
}
