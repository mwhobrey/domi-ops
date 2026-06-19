import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { householdMembers, households } from "@whome/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { deliverUserNotification } from "./user-notify.js";

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function scanDriveQuotaWarnings(db: Database, env: Env): Promise<number> {
  const warnPercent = env.DRIVE_QUOTA_WARN_PERCENT;
  const rows = await db
    .select({
      id: households.id,
      storageUsedBytes: households.storageUsedBytes,
      storageQuotaBytes: households.storageQuotaBytes,
      driveQuotaWarnSentAt: households.driveQuotaWarnSentAt,
    })
    .from(households)
    .where(isNotNull(households.storageQuotaBytes));

  let sent = 0;

  for (const row of rows) {
    const quota = row.storageQuotaBytes;
    if (quota == null || quota <= 0) continue;

    const percentUsed = Math.min(100, Math.round((row.storageUsedBytes / quota) * 100));
    const isWarning = percentUsed >= warnPercent && percentUsed < 100;

    if (!isWarning) {
      if (row.driveQuotaWarnSentAt != null && percentUsed < warnPercent - 5) {
        await db
          .update(households)
          .set({ driveQuotaWarnSentAt: null })
          .where(eq(households.id, row.id));
      }
      continue;
    }

    if (row.driveQuotaWarnSentAt != null) continue;

    const admins = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, row.id),
          inArray(householdMembers.role, ["owner", "admin"]),
        ),
      );
    const adminUserIds = admins.map((a) => a.userId);
    if (adminUserIds.length === 0) continue;

    const usedLabel = formatStorageBytes(row.storageUsedBytes);
    const quotaLabel = formatStorageBytes(quota);

    await deliverUserNotification(db, env, {
      userIds: adminUserIds,
      householdId: row.id,
      title: "Drive storage nearly full",
      body: `${usedLabel} of ${quotaLabel} used (${percentUsed}%)`,
      url: "/drive",
      tag: `drive-quota-${row.id}`,
    });

    await db
      .update(households)
      .set({ driveQuotaWarnSentAt: new Date() })
      .where(eq(households.id, row.id));
    sent += 1;
  }

  return sent;
}
