"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { CalendarEventView } from "../lib/calendar-utils";
import { Alert, Button, ConfirmDialog, EmptyState, Input } from "./ui";

export function CalendarEventSheet({
  open,
  selected,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  selected: CalendarEventView | null;
  onClose: () => void;
  onSaved: (ev: CalendarEventView, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [allDay, setAllDay] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setStartDate(selected.startDate);
      setStartTime(selected.startTime ?? "09:00");
      setAllDay(selected.allDay);
    } else if (open) {
      setTitle("");
      setStartDate(new Date().toISOString().slice(0, 10));
      setStartTime("09:00");
      setAllDay(false);
    }
    setError(null);
  }, [selected, open]);

  if (!open) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (selected) {
        const data = await apiClient.patch<{ event: CalendarEventView }>(
          `/api/calendar/events/${selected.id}`,
          { title, startDate, startTime: allDay ? null : startTime, allDay },
        );
        onSaved(
          {
            ...selected,
            ...data.event,
            title: data.event.title ?? title,
            startDate: data.event.startDate ?? startDate,
            startTime: allDay ? null : startTime,
            allDay,
          },
          false,
        );
      } else {
        const data = await apiClient.post<{ event: CalendarEventView }>("/api/calendar/events", {
          title,
          startDate,
          startTime: allDay ? undefined : startTime,
          allDay,
        });
        onSaved(data.event, true);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setConfirmDelete(false);
    setLoading(true);
    try {
      await apiClient.delete(`/api/calendar/events/${selected.id}`);
      onDeleted(selected.id);
      onClose();
    } catch {
      setError("Delete failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 md:bg-black/30" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="font-semibold">{selected ? "Edit event" : "New event"}</h2>
          <button type="button" className="text-[var(--color-text-muted)]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!selected && !title && (
            <EmptyState
              className="mb-4 border-none"
              title="Create an event"
              description="Fill in the form below."
            />
          )}
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}
          <form className="space-y-4" onSubmit={save}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Title</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Date</span>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
            {!allDay && (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Start time</span>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" loading={loading}>
                {selected ? "Save" : "Create"}
              </Button>
              {selected && (
                <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
          </form>
        </div>
      </aside>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete event?"
        message="This cannot be undone."
        confirmLabel="Delete"
        loading={loading}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
