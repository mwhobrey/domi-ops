import type { Database } from "@domi-ops/db";
import { households } from "@domi-ops/db";
import { eq } from "drizzle-orm";

export type DrivePermissionLevel = "none" | "read" | "write";

export type DriveRolePermissions = Partial<
  Record<"owner" | "admin" | "member" | "child" | "guest", DrivePermissionLevel>
>;

export const DEFAULT_DRIVE_ROLE_PERMISSIONS: DriveRolePermissions = {
  member: "write",
  child: "read",
  guest: "read",
};

const ADMIN_ROLES = new Set(["owner", "admin"]);
const CONFIGURABLE_ROLES = ["member", "child", "guest"] as const;

export function parseDrivePermissionsJson(raw: string | null | undefined): DriveRolePermissions {
  if (!raw?.trim()) return { ...DEFAULT_DRIVE_ROLE_PERMISSIONS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: DriveRolePermissions = { ...DEFAULT_DRIVE_ROLE_PERMISSIONS };
    for (const role of CONFIGURABLE_ROLES) {
      const value = parsed[role];
      if (value === "none" || value === "read" || value === "write") {
        result[role] = value;
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_DRIVE_ROLE_PERMISSIONS };
  }
}

export function serializeDrivePermissionsJson(perms: DriveRolePermissions): string {
  const out: Record<string, DrivePermissionLevel> = {};
  for (const role of CONFIGURABLE_ROLES) {
    const level = perms[role] ?? DEFAULT_DRIVE_ROLE_PERMISSIONS[role] ?? "read";
    out[role] = level;
  }
  return JSON.stringify(out);
}

export function normalizeDrivePermissionsPatch(
  body: DriveRolePermissions | undefined,
): DriveRolePermissions | null {
  if (!body || typeof body !== "object") return null;
  const result: DriveRolePermissions = {};
  for (const role of CONFIGURABLE_ROLES) {
    const value = body[role];
    if (value === "none" || value === "read" || value === "write") {
      result[role] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function resolveDrivePermissionForRole(
  householdRole: string,
  perms: DriveRolePermissions,
): DrivePermissionLevel {
  if (ADMIN_ROLES.has(householdRole)) return "write";
  const role = householdRole as keyof DriveRolePermissions;
  return perms[role] ?? DEFAULT_DRIVE_ROLE_PERMISSIONS[role] ?? "read";
}

export function canReadDrive(householdRole: string, perms: DriveRolePermissions): boolean {
  const level = resolveDrivePermissionForRole(householdRole, perms);
  return level === "read" || level === "write";
}

export function canWriteDrive(householdRole: string, perms: DriveRolePermissions): boolean {
  return resolveDrivePermissionForRole(householdRole, perms) === "write";
}

export async function loadHouseholdDrivePermissions(
  db: Database,
  householdId: string,
): Promise<DriveRolePermissions> {
  const [row] = await db
    .select({ drivePermissionsJson: households.drivePermissionsJson })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  return parseDrivePermissionsJson(row?.drivePermissionsJson);
}
