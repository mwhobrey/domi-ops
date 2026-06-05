import { importedStubEmail } from "@whome/config";
import { homeStatus, householdMembers, importRecords, users } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { requireDb } from "../lib/require-db.js";
import { sqliteTableExists } from "../lib/sqlite.js";
import type { ImportContext, MapperResult } from "./types.js";

function mapPresence(raw: unknown): "Home" | "Away" {
  const value = String(raw ?? "Away").trim().toLowerCase();
  return value === "home" ? "Home" : "Away";
}

async function lookupImportedMember(
  ctx: ImportContext,
  sourceId: string,
): Promise<string | null> {
  const db = requireDb(ctx);
  const [existing] = await db
    .select({ targetId: importRecords.targetId })
    .from(importRecords)
    .where(
      and(
        eq(importRecords.householdId, ctx.householdId),
        eq(importRecords.sourceTable, "home_status"),
        eq(importRecords.sourceId, sourceId),
      ),
    )
    .limit(1);
  return existing?.targetId ?? null;
}

/** Create stub users/members from SQLite `home_status` so school import resolves in one pass. */
export async function importHomeStatusMembers(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };

  if (!sqliteTableExists(ctx.sqlite, "home_status")) {
    result.warnings.push("home_status table not found — skipped stub members");
    return result;
  }

  const rows = ctx.sqlite
    .prepare("SELECT id, name, status FROM home_status ORDER BY id")
    .all() as Array<{ id: number; name: string; status: string | null }>;

  if (ctx.dryRun) {
    result.imported = rows.length;
    if (rows.length > 0) {
      result.warnings.push(
        `dry-run: would create ${rows.length} stub member(s) from home_status`,
      );
    }
    return result;
  }

  const db = requireDb(ctx);
  let ownerAssigned = false;

  const [existingOwner] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, ctx.householdId),
        eq(householdMembers.role, "owner"),
      ),
    )
    .limit(1);
  if (existingOwner) ownerAssigned = true;

  for (const row of rows) {
    const sourceId = String(row.id);
    const legacyName = String(row.name ?? "").trim();
    if (!legacyName) {
      result.warnings.push(`home_status ${sourceId}: empty name — skipped`);
      continue;
    }

    const existingMemberId = await lookupImportedMember(ctx, sourceId);
    if (existingMemberId) {
      ctx.idMap.set(`home_status:${sourceId}`, existingMemberId);
      result.skipped++;
      continue;
    }

    const stubEmail = importedStubEmail(legacyName, sourceId);
    const role = ownerAssigned ? "member" : "owner";
    if (!ownerAssigned) ownerAssigned = true;

    const [stubUser] = await db
      .insert(users)
      .values({
        email: stubEmail,
        displayName: legacyName.slice(0, 128),
        emailVerified: false,
      })
      .returning({ id: users.id });

    const [member] = await db
      .insert(householdMembers)
      .values({
        householdId: ctx.householdId,
        userId: stubUser.id,
        role,
        name: legacyName.slice(0, 128),
        legacyDisplayName: legacyName.slice(0, 64),
        legacyExternalId: sourceId,
        publicLabel: "name",
      })
      .returning({ id: householdMembers.id });

    await db.insert(homeStatus).values({
      householdId: ctx.householdId,
      memberId: member.id,
      name: legacyName.slice(0, 64),
      presence: mapPresence(row.status),
    });

    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "home_status",
      sourceId,
      targetTable: "household_members",
      targetId: member.id,
    });

    ctx.idMap.set(`home_status:${sourceId}`, member.id);
    result.imported++;
  }

  if (result.imported > 0) {
    result.warnings.push(
      "stub members created — claim on Google/email login via HOUSEHOLD_MEMBER_EMAIL_MAP or display name",
    );
  }

  return result;
}
