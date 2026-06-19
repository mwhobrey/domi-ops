"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { cn } from "../lib/cn";
import { Alert, Button, Sheet } from "./ui";

export type InboxNotification = {
  id: string;
  title: string;
  body: string;
  url: string;
  tag: string | null;
  read: boolean;
  createdAt: string;
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

export function NotificationInbox({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await apiClient.get<{ unreadCount: number }>(
        "/api/core/notifications/unread-count",
      );
      setUnreadCount(res.unreadCount);
    } catch {
      /* ignore badge errors */
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ notifications: InboxNotification[]; unreadCount: number }>(
        "/api/core/notifications",
      );
      setItems(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const id = window.setInterval(() => void refreshCount(), 60_000);
    return () => window.clearInterval(id);
  }, [refreshCount]);

  useEffect(() => {
    if (open) void loadItems();
  }, [open, loadItems]);

  async function markAllRead() {
    try {
      await apiClient.post("/api/core/notifications/mark-read", { all: true });
      setUnreadCount(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark read");
    }
  }

  async function markOneRead(id: string) {
    try {
      await apiClient.post("/api/core/notifications/mark-read", { ids: [id] });
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* best-effort */
    }
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]",
          className,
        )}
        aria-label="Notifications"
        onClick={() => setOpen(true)}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-white"
            aria-label={`${unreadCount} unread`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--color-text-muted)]">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
            {unreadCount > 0 ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => void markAllRead()}>
                Mark all read
              </Button>
            ) : null}
          </div>

          {error ? (
            <Alert variant="error" className="text-sm">
              {error}
            </Alert>
          ) : null}

          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]" aria-busy="true">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No notifications yet. System alerts from calendar, chores, school, and more will appear
              here — even when push is blocked.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.url}
                    className={cn(
                      "block py-3 transition hover:bg-[var(--color-border)]/30 -mx-2 px-2 rounded-lg",
                      !n.read && "bg-[var(--color-accent-subtle)]/40",
                    )}
                    onClick={() => {
                      if (!n.read) void markOneRead(n.id);
                      setOpen(false);
                    }}
                  >
                    <p className="text-sm font-medium text-[var(--color-text)]">{n.title}</p>
                    <p className="mt-0.5 text-sm text-[var(--color-text-muted)] line-clamp-2">
                      {n.body}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {formatWhen(n.createdAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}
