import type { AuthContext } from "@domi-ops/auth";
import { isDriveQuotaEnforced, type Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { driveObjects, driveShares, households, type driveObjects as driveObjectsTable } from "@domi-ops/db";
import { and, eq, exists, or } from "drizzle-orm";

export const DRIVE_TITLE_MAX_LEN = 256;

export type DriveObjectKind = "file" | "link";
export type DriveVisibility = "household" | "private";

export function driveVisibleWhere(db: Database, auth: AuthContext) {
  return and(
    eq(driveObjects.householdId, auth.householdId),
    or(
      eq(driveObjects.visibility, "household"),
      and(eq(driveObjects.visibility, "private"), eq(driveObjects.createdByUserId, auth.userId)),
      and(
        eq(driveObjects.visibility, "private"),
        exists(
          db
            .select({ driveObjectId: driveShares.driveObjectId })
            .from(driveShares)
            .where(
              and(
                eq(driveShares.driveObjectId, driveObjects.id),
                eq(driveShares.memberId, auth.memberId),
              ),
            ),
        ),
      ),
    ),
  );
}

export function normalizeDriveTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (!title) return null;
  return title.slice(0, DRIVE_TITLE_MAX_LEN);
}

export function normalizeDriveKind(value: unknown): DriveObjectKind | null {
  if (value === "file" || value === "link") return value;
  return null;
}

export function normalizeDriveVisibility(value: unknown): DriveVisibility {
  return value === "private" ? "private" : "household";
}

export function sanitizeDriveFilename(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);
}

export function driveObjectKey(
  householdId: string,
  objectId: string,
  filename: string,
): string {
  return `drive/${householdId}/${objectId}/${sanitizeDriveFilename(filename)}`;
}

export function isDriveKeyForHousehold(householdId: string, key: string): boolean {
  const prefix = `drive/${householdId}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  const parts = rest.split("/");
  return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
}

export function objectIdFromDriveKey(householdId: string, key: string): string | null {
  if (!isDriveKeyForHousehold(householdId, key)) return null;
  const rest = key.slice(`drive/${householdId}/`.length);
  return rest.split("/")[0] ?? null;
}

export function filenameFromDriveKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? "";
}

export function parseDriveTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    }
  } catch {
    // ignore invalid JSON
  }
  return [];
}

export function serializeDriveTagsJson(tags: string[] = []): string {
  const parts = tags.map((t) => t.trim()).filter(Boolean);
  return JSON.stringify(parts);
}

export function driveObjectMatchesSearch(
  title: string,
  description: string | null,
  s3Key: string | null,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (title.toLowerCase().includes(needle)) return true;
  if (description?.toLowerCase().includes(needle)) return true;
  if (s3Key) {
    const filename = filenameFromDriveKey(s3Key);
    if (filename.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function driveObjectHasTag(tagsJson: string | null | undefined, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return parseDriveTagsJson(tagsJson).some((t) => t.toLowerCase() === needle);
}

export async function collectDriveTagSuggestions(
  db: Database,
  householdId: string,
  q: string,
): Promise<string[]> {
  const rows = await db
    .select({ tagsJson: driveObjects.tagsJson })
    .from(driveObjects)
    .where(eq(driveObjects.householdId, householdId));

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const needle = q.trim().toLowerCase();

  for (const row of rows) {
    for (const tag of parseDriveTagsJson(row.tagsJson)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      if (needle && !key.includes(needle)) continue;
      seen.add(key);
      suggestions.push(tag);
    }
  }

  suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return suggestions.slice(0, 25);
}

export function validateDriveObjectFields(
  kind: DriveObjectKind,
  body: {
    url?: string | null;
    s3Key?: string | null;
    contentType?: string | null;
    byteSize?: number | null;
  },
): string | null {
  if (kind === "link") {
    const url = body.url?.trim();
    if (!url) return "url_required";
    try {
      new URL(url);
    } catch {
      return "invalid_url";
    }
    return null;
  }
  const s3Key = body.s3Key?.trim();
  if (!s3Key) return "s3_key_required";
  if (!body.contentType?.trim()) return "content_type_required";
  const byteSize = body.byteSize;
  if (byteSize == null || !Number.isFinite(byteSize) || byteSize < 0) {
    return "byte_size_required";
  }
  return null;
}

export function serializeDriveTags(row: typeof driveObjectsTable.$inferSelect): string[] {
  return parseDriveTagsJson(row.tagsJson);
}

export async function checkDriveUploadQuota(
  db: Database,
  env: Env,
  householdId: string,
  additionalBytes: number,
): Promise<"ok" | "quota_exceeded"> {
  if (!isDriveQuotaEnforced(env) || additionalBytes <= 0) return "ok";
  const [row] = await db
    .select({
      storageQuotaBytes: households.storageQuotaBytes,
      storageUsedBytes: households.storageUsedBytes,
    })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  if (!row || row.storageQuotaBytes == null) return "ok";
  if (row.storageUsedBytes + additionalBytes > row.storageQuotaBytes) {
    return "quota_exceeded";
  }
  return "ok";
}
