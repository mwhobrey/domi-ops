import type { Env } from "@domi-ops/config";

export type DriveStorageStats = {
  usedBytes: number;
  quotaBytes: number | null;
  percentUsed: number | null;
  warnPercent: number;
  isWarning: boolean;
  isFull: boolean;
  unlimited: boolean;
};

export function computeDriveStorageStats(
  usedBytes: number,
  quotaBytes: number | null,
  env: Env,
): DriveStorageStats {
  const unlimited = quotaBytes == null;
  const percentUsed =
    unlimited || quotaBytes <= 0 ? null : Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  const warnPercent = env.DRIVE_QUOTA_WARN_PERCENT;
  const isWarning =
    !unlimited && percentUsed != null && percentUsed >= warnPercent && percentUsed < 100;
  const isFull = !unlimited && quotaBytes != null && usedBytes >= quotaBytes;
  return {
    usedBytes,
    quotaBytes,
    percentUsed,
    warnPercent,
    isWarning,
    isFull,
    unlimited,
  };
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
