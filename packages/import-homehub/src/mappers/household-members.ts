import { householdMembers, users } from "@domi-ops/db";
import { eq, and } from "drizzle-orm";
import { requireDb } from "../lib/require-db.js";
import { sqliteTableExists } from "../lib/sqlite.js";
import { lookupImportedTarget } from "../lib/import-record-index.js";
import {
  createStubMember,
  ensureMemberHomeStatus,
  primaryClaimEmail,
  syncStubClaimEmails,
} from "../lib/stub-member.js";
import type { ImportContext, MapperResult } from "./types.js";

function mapPresence(raw: unknown): "Home" | "Away" {
  const value = String(raw ?? "Away").trim().toLowerCase();
  return value === "home" ? "Home" : "Away";
}

async function lookupImportedMember(
  ctx: ImportContext,
  sourceTable: string,
  sourceId: string,
): Promise<string | null> {
  const db = requireDb(ctx);
  return lookupImportedTarget(db, ctx.importRecordIndex, ctx.householdId, sourceTable, sourceId);
}

async function refreshExistingStubClaims(ctx: ImportContext, memberId: string): Promise<void> {
  const db = requireDb(ctx);
  const [row] = await db
    .select({
      userId: householdMembers.userId,
      legacyDisplayName: householdMembers.legacyDisplayName,
      name: householdMembers.name,
    })
    .from(householdMembers)
    .where(eq(householdMembers.id, memberId))
    .limit(1);
  if (!row) return;

  const legacyKey = (row.legacyDisplayName ?? row.name ?? "").trim().toLowerCase();
  const directory = legacyKey ? ctx.memberDirectory.get(legacyKey) : undefined;
  const label = row.legacyDisplayName ?? row.name ?? directory?.legacyName ?? "Member";
  await ensureMemberHomeStatus(db, ctx.householdId, memberId, label);

  if (!directory || directory.claimEmails.size === 0) return;

  await syncStubClaimEmails(db, ctx.householdId, memberId, row.userId, directory.claimEmails);
  await db
    .update(users)
    .set({ importClaimEmail: primaryClaimEmail(directory) })
    .where(eq(users.id, row.userId));
}

/** Create/update stub members from HomeHub config.yml + SQLite home_status. */
export async function importHouseholdMembers(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  const directory = ctx.memberDirectory;

  const homeStatusRows = sqliteTableExists(ctx.sqlite, "home_status")
    ? (ctx.sqlite
        .prepare("SELECT id, name, status FROM home_status ORDER BY id")
        .all() as Array<{ id: number; name: string; status: string | null }>)
    : [];

  const configOnlyNames = [...directory.values()].filter(
    (entry) =>
      !homeStatusRows.some(
        (row) => row.name.trim().toLowerCase() === entry.legacyName.trim().toLowerCase(),
      ),
  );

  if (ctx.dryRun) {
    result.imported = homeStatusRows.length + configOnlyNames.length;
    if (result.imported > 0) {
      result.warnings.push(
        `dry-run: would ensure ${result.imported} stub member(s) from config.yml + home_status`,
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

  const seenLegacy = new Set<string>();

  for (const row of homeStatusRows) {
    const sourceId = String(row.id);
    const legacyName = String(row.name ?? "").trim();
    if (!legacyName) {
      result.warnings.push(`home_status ${sourceId}: empty name — skipped`);
      continue;
    }

    seenLegacy.add(legacyName.toLowerCase());
    const directoryEntry = directory.get(legacyName.toLowerCase());

    const existingMemberId = await lookupImportedMember(ctx, "home_status", sourceId);
    if (existingMemberId) {
      ctx.idMap.set(`home_status:${sourceId}`, existingMemberId);
      await refreshExistingStubClaims(ctx, existingMemberId);
      result.skipped++;
      continue;
    }

    let role = directoryEntry?.role ?? "member";
    if (ownerAssigned && role === "owner") role = "admin";
    if (!ownerAssigned && role === "owner") ownerAssigned = true;
    if (
      !ownerAssigned &&
      !existingOwner &&
      ctx.homeHubConfig.adminEmails.length === 0 &&
      role !== "child"
    ) {
      role = "owner";
      ownerAssigned = true;
    }

    const created = await createStubMember(db, {
      householdId: ctx.householdId,
      legacyName,
      role,
      sourceTable: "home_status",
      sourceId,
      directory: directoryEntry,
      presence: mapPresence(row.status),
    });

    ctx.idMap.set(`home_status:${sourceId}`, created.memberId);
    result.imported++;
  }

  for (const entry of configOnlyNames) {
    const legacyKey = entry.legacyName.toLowerCase();
    if (seenLegacy.has(legacyKey)) continue;

    const sourceId = `config:${legacyKey}`;
    const existingMemberId = await lookupImportedMember(ctx, "homehub_config_member", sourceId);
    if (existingMemberId) {
      ctx.idMap.set(`homehub_config:${sourceId}`, existingMemberId);
      await refreshExistingStubClaims(ctx, existingMemberId);
      result.skipped++;
      continue;
    }

    let role = entry.role;
    if (ownerAssigned && role === "owner") role = "admin";
    if (!ownerAssigned && role === "owner") ownerAssigned = true;

    const created = await createStubMember(db, {
      householdId: ctx.householdId,
      legacyName: entry.legacyName,
      role,
      sourceTable: "homehub_config_member",
      sourceId,
      directory: entry,
    });

    ctx.idMap.set(`homehub_config:${sourceId}`, created.memberId);
    result.imported++;
  }

  if (result.imported > 0) {
    result.warnings.push(
      "stub members created — claim on Google/email login via import claim emails from config.yml",
    );
  }

  return result;
}

/** @deprecated use importHouseholdMembers */
export const importHomeStatusMembers = importHouseholdMembers;
