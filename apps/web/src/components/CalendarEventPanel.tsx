"use client";

import { useState } from "react";
import type { CalendarEventView } from "./CalendarWeek";

export function CalendarEventPanel({
  initialEvents,
}: {
  initialEvents: CalendarEventView[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [selected, setSelected] = useState<CalendarEventView | null>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [msg, setMsg] = useState<string | null>(null);

  function openNew() {
    setSelected(null);
    setTitle("");
    setStartDate(new Date().toISOString().slice(0, 10));
    setStartTime("09:00");
  }

  function openEdit(ev: CalendarEventView) {
    setSelected(ev);
    setTitle(ev.title);
    setStartDate(ev.startDate);
    setStartTime(ev.startTime ?? "09:00");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
          onClick={openNew}
        >
          New event
        </button>
        {selected && (
          <button
            type="button"
            className="rounded-xl border border-red-500/50 px-4 py-2 text-sm text-red-400"
            onClick={async () => {
              await fetch(`/api/calendar/events/${selected.id}`, {
                method: "DELETE",
                credentials: "include",
              });
              setEvents((prev) => prev.filter((e) => e.id !== selected.id));
              openNew();
            }}
          >
            Delete
          </button>
        )}
      </div>
      <form
        className="grid max-w-md gap-2 rounded-2xl border border-[var(--color-border)] p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg("Saving…");
          try {
            if (selected) {
              const res = await fetch(`/api/calendar/events/${selected.id}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, startDate, startTime }),
              });
              if (!res.ok) throw new Error(await res.text());
              const data = (await res.json()) as { event: CalendarEventView };
              setEvents((prev) => prev.map((x) => (x.id === selected.id ? { ...x, ...data.event } : x)));
            } else {
              const res = await fetch("/api/calendar/events", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, startDate, startTime, allDay: false }),
              });
              if (!res.ok) throw new Error(await res.text());
              const data = (await res.json()) as { event: CalendarEventView };
              setEvents((prev) => [...prev, data.event]);
            }
            setMsg("Saved");
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Failed");
          }
        }}
      >
        <input
          className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <input
          type="date"
          className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <input
          type="time"
          className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        <button type="submit" className="rounded-lg bg-[var(--color-accent)] py-2 text-sm text-white">
          {selected ? "Update event" : "Create event"}
        </button>
        {msg && <p className="text-xs text-[var(--color-text-muted)]">{msg}</p>}
      </form>
      <ul className="space-y-1 text-sm">
        {events.map((ev) => (
          <li key={ev.id}>
            <button
              type="button"
              className="text-left text-[var(--color-accent)] hover:underline"
              onClick={() => openEdit(ev)}
            >
              {ev.startDate} · {ev.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
