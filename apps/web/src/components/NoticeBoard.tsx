"use client";

import { Bell, Megaphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchPushConfig,
  isPushSupported,
  subscribeBrowserPush,
  syncPushSubscription,
} from "../lib/web-push";
import { ApiError, apiClient } from "../lib/client-api";
import { isNoticeMirrorAlert, showBrowserNotification } from "../lib/browser-notify";
import { cn } from "../lib/cn";
import { useLiveRefresh } from "../lib/use-live-refresh";
import type { DriveAttachmentSummary } from "../lib/drive-types";
import { driveAttachmentToReference } from "../lib/drive-types";
import { DriveAttachmentChips } from "./DriveAttachmentChips";
import { DriveObjectPicker } from "./DriveObjectPicker";
import { Alert, Button, Sheet, Textarea } from "./ui";

export type NoticeItem = {
  id: string;
  content: string;
  postedByUserId: string | null;
  postedByDisplayName: string | null;
  createdAt: string;
  read: boolean;
  isOwn: boolean;
  attachments?: DriveAttachmentSummary[];
};

export type InboxNotification = {
  id: string;
  title: string;
  body: string;
  url: string;
  tag: string | null;
  read: boolean;
  createdAt: string;
};

type PanelTab = "notices" | "alerts";

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

export function NoticeBoardActions({
  className,
  onOpenChange,
}: {
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("notices");
  const [pushPrompt, setPushPrompt] = useState(false);
  const [noticeUnread, setNoticeUnread] = useState(0);
  const [alertUnread, setAlertUnread] = useState(0);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [alerts, setAlerts] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<DriveAttachmentSummary[]>([]);
  const prevTotalUnread = useRef(0);
  const skipNotifyOnce = useRef(true);

  const totalUnread = noticeUnread + alertUnread;

  const loadNotices = useCallback(async () => {
    const res = await apiClient.get<{ notices: NoticeItem[]; unreadCount: number }>(
      "/api/core/notices",
    );
    setNotices(res.notices);
    setNoticeUnread(res.unreadCount);
    return res;
  }, []);

  const loadAlerts = useCallback(async () => {
    const res = await apiClient.get<{ notifications: InboxNotification[]; unreadCount: number }>(
      "/api/core/notifications",
    );
    const filtered = res.notifications.filter((n) => !isNoticeMirrorAlert(n.tag));
    setAlerts(filtered);
    setAlertUnread(filtered.filter((n) => !n.read).length);
    return { ...res, notifications: res.notifications };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [noticeCountRes, notifRes] = await Promise.all([
        apiClient.get<{ unreadCount: number }>("/api/core/notices/unread-count"),
        apiClient.get<{ notifications: InboxNotification[] }>("/api/core/notifications"),
      ]);

      setNoticeUnread(noticeCountRes.unreadCount);
      const filtered = notifRes.notifications.filter((n) => !isNoticeMirrorAlert(n.tag));
      const alertU = filtered.filter((n) => !n.read).length;
      setAlertUnread(alertU);
      if (open) setAlerts(filtered);

      const total = noticeCountRes.unreadCount + alertU;
      const newestUnread = notifRes.notifications.find((n) => !n.read);
      if (skipNotifyOnce.current) {
        skipNotifyOnce.current = false;
      } else if (newestUnread && total > prevTotalUnread.current && !open) {
        void showBrowserNotification(
          newestUnread.title,
          newestUnread.body,
          newestUnread.url,
          newestUnread.tag ?? undefined,
        );
      }
      prevTotalUnread.current = total;
    } catch {
      /* polling best-effort */
    }
  }, [open]);

  const loadPanel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadNotices(), loadAlerts()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, [loadAlerts, loadNotices]);

  useLiveRefresh(
    useCallback(async () => {
      if (open) await loadPanel();
      else await refresh();
    }, [open, loadPanel, refresh]),
    { intervalMs: 15_000 },
  );

  useEffect(() => {
    void apiClient
      .get<{ modulesEnabled?: string[] }>("/auth/session")
      .then((s) => setDriveEnabled(s.modulesEnabled?.includes("drive") ?? false))
      .catch(() => setDriveEnabled(false));
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) void loadPanel();
  }, [open, loadPanel]);

  useEffect(() => {
    if (searchParams.get("notices") === "1") {
      setTab("notices");
      setOpen(true);
    }
    if (searchParams.get("alerts") === "1") {
      setTab("alerts");
      setOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isPushSupported() || Notification.permission !== "granted") return;
    void fetchPushConfig().then((cfg) => {
      if (cfg.enabled && cfg.publicKey) void syncPushSubscription(cfg.publicKey);
    });
  }, []);

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
      await apiClient.post("/api/core/notices", {
        content,
        driveObjectIds: pendingAttachments.map((a) => a.driveObjectId),
      });
      setDraft("");
      setPendingAttachments([]);
      await loadPanel();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post notice");
    } finally {
      setPosting(false);
    }
  }

  async function markNoticeRead(id: string) {
    try {
      await apiClient.post(`/api/core/notices/${id}/read`);
      setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setNoticeUnread((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function markAllNoticesRead() {
    try {
      await apiClient.post("/api/core/notices/read-all");
      setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
      setNoticeUnread(0);
    } catch {
      /* ignore */
    }
  }

  async function markAlertRead(id: string) {
    try {
      await apiClient.post("/api/core/notifications/mark-read", { ids: [id] });
      setAlerts((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setAlertUnread((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function markAllAlertsRead() {
    try {
      await apiClient.post("/api/core/notifications/mark-read", { all: true });
      setAlerts((prev) => prev.map((n) => ({ ...n, read: true })));
      setAlertUnread(0);
    } catch {
      /* ignore */
    }
  }

  const unreadNotices = notices.filter((n) => !n.read && !n.isOwn);
  const latest = notices[0] ?? null;
  const showLatestHighlight = noticeUnread === 0 && latest;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notices and alerts"
        className={cn(
          "relative inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-elevated)] max-sm:px-2.5 max-sm:py-2",
          className,
        )}
      >
        <Megaphone className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
        <span className="max-sm:sr-only">Notices</span>
        {totalUnread > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-white"
            aria-label={`${totalUnread} unread`}
          >
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notices & alerts">
        <div className="flex flex-col gap-4 p-5">
          <div
            className="flex rounded-[var(--radius-lg)] border border-[var(--color-border)] p-1 text-sm"
            role="tablist"
            aria-label="Notice panel section"
          >
            {(
              [
                { id: "notices" as const, label: "Notices", count: noticeUnread },
                { id: "alerts" as const, label: "Alerts", count: alertUnread },
              ] as const
            ).map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cn(
                  "relative min-h-10 flex-1 rounded-[var(--radius-md)] px-3 py-2 font-medium transition-colors",
                  tab === id
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
                onClick={() => setTab(id)}
              >
                {label}
                {count > 0 ? (
                  <span className="ml-1.5 text-xs opacity-90">({count > 9 ? "9+" : count})</span>
                ) : null}
              </button>
            ))}
          </div>

          {error && (
            <Alert variant="error" className="text-sm">
              {error}
            </Alert>
          )}

          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : tab === "notices" ? (
            <>
              {noticeUnread > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-label text-[var(--color-text-muted)]">{noticeUnread} unread</p>
                  <Button size="sm" variant="secondary" onClick={() => void markAllNoticesRead()}>
                    Mark all read
                  </Button>
                </div>
              )}

              {unreadNotices.length > 0 && (
                <ul className="space-y-2">
                  {unreadNotices.map((n) => (
                    <NoticeCard key={n.id} notice={n} onMarkRead={() => void markNoticeRead(n.id)} />
                  ))}
                </ul>
              )}

              {showLatestHighlight && (
                <div>
                  <p className="text-label mb-2 text-[var(--color-text-muted)]">Latest</p>
                  <NoticeCard notice={latest} />
                </div>
              )}

              {notices.length > 0 && noticeUnread > 0 && (
                <p className="text-label text-[var(--color-text-muted)]">All notices</p>
              )}

              {notices.length > 0 && (
                <ul className="max-h-[40vh] space-y-2 overflow-y-auto">
                  {notices
                    .filter((n) => !unreadNotices.some((u) => u.id === n.id))
                    .filter((n) => !(showLatestHighlight && n.id === latest?.id))
                    .map((n) => (
                      <NoticeCard
                        key={n.id}
                        notice={n}
                        muted
                        onMarkRead={!n.read && !n.isOwn ? () => void markNoticeRead(n.id) : undefined}
                      />
                    ))}
                </ul>
              )}

              {notices.length === 0 && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No notices yet. Post one for the household.
                </p>
              )}

              {pushPrompt && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm">
                  <p className="text-[var(--color-text-muted)]">
                    Get desktop alerts when someone posts or when reminders fire?
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
                      Enable desktop alerts
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
                {driveEnabled ? (
                  <div className="mt-2 space-y-2">
                    {pendingAttachments.length > 0 ? (
                      <DriveAttachmentChips
                        references={pendingAttachments.map(driveAttachmentToReference)}
                        onRemove={(id) =>
                          setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
                        }
                      />
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setPickerOpen(true)}
                    >
                      Attach from Drive
                    </Button>
                  </div>
                ) : null}
                <Button className="mt-2" size="sm" loading={posting} onClick={() => void postNotice()}>
                  Post notice
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-[var(--color-text-muted)]">
                  {alertUnread > 0 ? `${alertUnread} unread` : "Calendar, chores, school, and system alerts"}
                </p>
                {alertUnread > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => void markAllAlertsRead()}>
                    Mark all read
                  </Button>
                ) : null}
              </div>

              {alerts.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No alerts yet. Reminders and household events will show here.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {alerts.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={n.url}
                        className={cn(
                          "block py-3 transition hover:bg-[var(--color-border)]/30 -mx-2 px-2 rounded-lg",
                          !n.read && "bg-[var(--color-accent-subtle)]/40",
                        )}
                        onClick={() => {
                          if (!n.read) void markAlertRead(n.id);
                          setOpen(false);
                        }}
                      >
                        <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                          <Bell className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
                          {n.title}
                        </p>
                        <p className="mt-0.5 pl-6 text-sm text-[var(--color-text-muted)] line-clamp-2">
                          {n.body}
                        </p>
                        <p className="mt-1 pl-6 text-xs text-[var(--color-text-muted)]">
                          {formatWhen(n.createdAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Sheet>

      {driveEnabled ? (
        <DriveObjectPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="Attach Drive file to notice"
          excludeIds={pendingAttachments.map((a) => a.driveObjectId)}
          onSelect={(object) => {
            setPendingAttachments((prev) => [
              ...prev,
              {
                id: `pending-${object.id}`,
                driveObjectId: object.id,
                title: object.title,
                kind: object.kind,
                filename: object.filename,
                url: object.url,
              },
            ]);
          }}
        />
      ) : null}
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
      {(notice.attachments ?? []).length > 0 ? (
        <div className="mt-2">
          <DriveAttachmentChips
            references={(notice.attachments ?? []).map(driveAttachmentToReference)}
          />
        </div>
      ) : null}
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
