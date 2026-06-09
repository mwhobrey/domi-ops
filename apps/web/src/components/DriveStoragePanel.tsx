"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { DriveShareToken, DriveStorageInfo } from "../lib/drive-types";
import { Alert, Button, SectionHeader } from "./ui";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DriveStoragePanel({
  initialStorage,
  publicSharesEnabled,
}: {
  initialStorage: DriveStorageInfo | null;
  publicSharesEnabled?: boolean;
}) {
  const storage = initialStorage;
  const [tokens, setTokens] = useState<DriveShareToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!publicSharesEnabled) return;
    setLoadingTokens(true);
    void apiClient
      .get<{ enabled: boolean; tokens: DriveShareToken[] }>("/api/core/drive/share-tokens")
      .then((data) => setTokens(data.tokens))
      .catch(() => setTokens([]))
      .finally(() => setLoadingTokens(false));
  }, [publicSharesEnabled]);

  if (!storage) return null;

  const unlimited = storage.quotaBytes == null;
  const percent =
    unlimited || !storage.quotaBytes
      ? null
      : Math.min(100, Math.round((storage.usedBytes / storage.quotaBytes) * 100));
  const barTone =
    percent != null && percent >= 100
      ? "bg-[var(--color-danger)]"
      : percent != null && percent >= 90
        ? "bg-[var(--color-warning)]"
        : "bg-[var(--color-accent)]";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SectionHeader title="Drive storage" />
        <p className="text-sm text-[var(--color-text-muted)]">
          Household file storage usage. Uploads may be blocked when the quota is full if enforcement
          is enabled on the server.
        </p>
        <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {formatBytes(storage.usedBytes)}
              {unlimited ? " used" : ` of ${formatBytes(storage.quotaBytes!)}`}
            </span>
            {percent != null ? (
              <span className="tabular-nums text-[var(--color-text-muted)]">{percent}%</span>
            ) : (
              <span className="text-[var(--color-text-muted)]">Unlimited</span>
            )}
          </div>
          {!unlimited ? (
            <div
              className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-subtle)]"
              role="progressbar"
              aria-valuenow={percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Drive storage used"
            >
              <div
                className={`h-full rounded-full transition-all ${barTone}`}
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {publicSharesEnabled ? (
        <div className="space-y-3">
          <SectionHeader title="Public share links" />
          <p className="text-sm text-[var(--color-text-muted)]">
            Active links that allow anyone with the URL to download a file. Revoke links you no
            longer need.
          </p>
          {loadingTokens ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading share links…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No active share links.</p>
          ) : (
            <ul className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)]/60 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{token.objectTitle ?? "File"}</p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {token.shareUrl}
                      {token.hasPassword ? " · password protected" : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Revoke share link for ${token.objectTitle ?? "file"}`}
                    onClick={async () => {
                      setMsg(null);
                      try {
                        await apiClient.delete(`/api/core/drive/share-tokens/${token.id}`);
                        setTokens((prev) => prev.filter((t) => t.id !== token.id));
                        setMsg("Share link revoked");
                      } catch (err) {
                        setMsg(err instanceof ApiError ? err.message : "Could not revoke link");
                      }
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {msg ? <Alert variant="success">{msg}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}
