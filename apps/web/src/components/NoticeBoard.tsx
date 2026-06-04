"use client";

import { Megaphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchPushConfig,
  isPushSupported,
  subscribeBrowserPush,
} from "../lib/web-push";
import { ApiError, apiClient } from "../lib/client-api";
import { cn } from "../lib/cn";
import { Alert, Button, Sheet, Textarea } from "./ui";

export type NoticeItem = {
  id: string;
  content: string;
  postedByUserId: string | null;
  postedByDisplayName: string | null;
  createdAt: string;
  read: boolean;
  isOwn: boolean;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NoticeBoardActions({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pushPrompt, setPushPrompt] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await apiClient.get<{ unreadCount: number }>("/api/core/notices/unread-count");
      setUnreadCount(res.unreadCount);
    } catch {
      /* ignore badge errors */
    }
  }, []);

  const loadNotices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ notices: NoticeItem[]; unreadCount: number }>(
        "/api/core/notices",
      );
      setNotices(res.notices);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load notices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  useEffect(() => {
    if (open) loadNotices();
  }, [open, loadNotices]);

  useEffect(() => {
    if (searchParams.get("notices") === "1") setOpen(true);
  }, [searchParams]);

  useEffect(() => {
    if (!isPushSupported() || Notification.permission !== "default") return;
    void fetchPushConfig().then(async (cfg) => {
      if (!cfg.enabled || !cfg.publicKey) return;
      try {
        const profile = await apiClient.get<{ pushNoticesEnabled?: boolean; pushSubscribed?: boolean }>(
          "/api/core/profile",
        );
        if (profile.pushNoticesEnabled !== false && !profile.pushSubscribed) {
          setPushPrompt(true);
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  async function postNotice() {
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    setError(null);
    try {
      await apiClient.post("/api/core/notices", { content });
      setDraft("");
      await loadNotices();
      await refreshCount();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post notice");
    } finally {
      setPosting(false);
    }
  }

  async function markRead(id: string) {
    try {
      await apiClient.post(`/api/core/notices/${id}/read`);
      setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function markAllRead() {
    try {
      await apiClient.post("/api/core/notices/read-all");
      setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
  }

  const unread = notices.filter((n) => !n.read && !n.isOwn);
  const latest = notices[0] ?? null;
  const showLatestHighlight = unreadCount === 0 && latest;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-elevated)]",
          className,
        )}
      >
        <Megaphone className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
        Notice board
        {unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-white"
            aria-label={`${unreadCount} unread`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notice board">
        <div className="flex flex-col gap-4 p-5">
          {error && (
            <Alert variant="error" className="text-sm">
              {error}
            </Alert>
          )}

          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : (
            <>
              {unreadCount > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-label text-[var(--color-text-muted)]">
                    {unreadCount} unread
                  </p>
                  <Button size="sm" variant="secondary" onClick={markAllRead}>
                    Mark all read
                  </Button>
                </div>
              )}

              {unread.length > 0 && (
                <ul className="space-y-2">
                  {unread.map((n) => (
                    <NoticeCard key={n.id} notice={n} onMarkRead={() => markRead(n.id)} />
                  ))}
                </ul>
              )}

              {showLatestHighlight && (
                <div>
                  <p className="text-label mb-2 text-[var(--color-text-muted)]">Latest</p>
                  <NoticeCard notice={latest} />
                </div>
              )}

              {notices.length > 0 && unreadCount > 0 && (
                <p className="text-label text-[var(--color-text-muted)]">All notices</p>
              )}

              {notices.length > 0 && (
                <ul className="max-h-[40vh] space-y-2 overflow-y-auto">
                  {notices
                    .filter((n) => !unread.some((u) => u.id === n.id))
                    .filter((n) => !(showLatestHighlight && n.id === latest?.id))
                    .map((n) => (
                      <NoticeCard
                        key={n.id}
                        notice={n}
                        muted
                        onMarkRead={!n.read && !n.isOwn ? () => markRead(n.id) : undefined}
                      />
                    ))}
                </ul>
              )}

              {notices.length === 0 && !loading && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No notices yet. Post one for the household.
                </p>
              )}
            </>
          )}

          {pushPrompt && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm">
              <p className="text-[var(--color-text-muted)]">
                Get notified when someone posts a notice?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const cfg = await fetchPushConfig();
                    if (cfg.publicKey) {
                      const ok = await subscribeBrowserPush(cfg.publicKey);
                      if (ok) setPushPrompt(false);
                    }
                  }}
                >
                  Enable notifications
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPushPrompt(false)}>
                  Not now
                </Button>
              </div>
            </div>
          )}

          <div className="border-t border-[var(--color-border)] pt-4">
            <Textarea
              className="min-h-[88px]"
              placeholder="Post a notice for everyone…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button className="mt-2" size="sm" loading={posting} onClick={postNotice}>
              Post notice
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function NoticeCard({
  notice,
  muted,
  onMarkRead,
}: {
  notice: NoticeItem;
  muted?: boolean;
  onMarkRead?: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-[var(--radius-lg)] border px-3 py-2.5 text-sm",
        !notice.read && !notice.isOwn
          ? "border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)]/30"
          : "border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]",
        muted && "opacity-80",
      )}
    >
      <p className="whitespace-pre-wrap">{notice.content}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
        <span>
          {notice.postedByDisplayName ?? "Household"}
          {notice.isOwn ? " · you" : ""} · {formatWhen(notice.createdAt)}
        </span>
        {onMarkRead && (
          <button
            type="button"
            className="font-medium text-[var(--color-accent)] hover:underline"
            onClick={onMarkRead}
          >
            Mark read
          </button>
        )}
      </div>
    </li>
  );
}
