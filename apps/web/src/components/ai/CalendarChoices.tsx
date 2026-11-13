"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { connectionError, type OwnCalendar } from "../../lib/mcp";
import { Button, Checkbox } from "../ui";

/**
 * Lets a member pick which calendars an assistant may read busy time from. Calendar names appear
 * here for the member only; what is sent is when they are busy, never what an event is.
 */
export function CalendarChoices({ idPrefix, householdId, value, onChange, disabled }: {
  idPrefix: string; householdId: string; value: string[]; onChange: (calendarIds: string[]) => void; disabled: boolean;
}) {
  const [calendars, setCalendars] = useState<OwnCalendar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ open: boolean; loading: boolean; text: string | null; error: string | null }>({ open: false, loading: false, text: null, error: null });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await apiClient.post<{ calendars: OwnCalendar[] }>("/api/mcp-auth/calendars", { householdId });
        if (!cancelled) setCalendars(result.calendars);
      } catch (e) { if (!cancelled) setError(connectionError(e)); }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  // A preview belongs to the selection it was requested for; any change or close drops a response still in flight.
  const turn = useRef(0);
  function toggle(id: string, shared: boolean) {
    turn.current++;
    setPreview((state) => ({ ...state, open: false }));
    onChange(shared ? [...value, id] : value.filter((entry) => entry !== id));
  }
  async function togglePreview() {
    const current = ++turn.current;
    if (preview.open) { setPreview({ ...preview, open: false }); return; }
    setPreview({ open: true, loading: true, text: null, error: null });
    try {
      const result = await apiClient.post<{ payload: unknown }>("/api/mcp-auth/calendars/preview", { householdId, calendarIds: value });
      if (turn.current === current) setPreview({ open: true, loading: false, text: JSON.stringify(result.payload, null, 2), error: null });
    } catch (e) { if (turn.current === current) setPreview({ open: true, loading: false, text: null, error: connectionError(e) }); }
  }

  if (error) return <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>;
  if (!calendars) return <p role="status" className="text-sm">Loading your calendars…</p>;
  if (!calendars.length) return <p className="text-sm text-[var(--color-text-muted)]">You have no calendars to share. Create one in Calendar, then come back.</p>;
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="font-medium">Calendars to share busy times from ({value.length})</legend>
    <p className="text-sm text-[var(--color-text-muted)]">Nothing is shared unless you tick it. The assistant gets only the times you are busy, merged into blocks. Event titles, locations, people and calendar names are never sent; the names below are shown only to you. Events imported from Google Calendar are left out, and the assistant is told its answer may be incomplete.</p>
    {calendars.map((calendar) => <Checkbox key={calendar.id} id={`${idPrefix}-calendar-${calendar.id}`} checked={value.includes(calendar.id)}
      label={`${calendar.name || "Unnamed calendar"} · ${calendar.visibility === "household" ? "household" : "private"}`}
      onChange={(e) => toggle(calendar.id, e.target.checked)} />)}
    {value.length > 0 && <div className="space-y-2">
      <Button type="button" variant="secondary" aria-expanded={preview.open} onClick={() => void togglePreview()}>{preview.open ? "Hide what the assistant receives" : "See what the assistant receives"}</Button>
      {preview.open && preview.loading && <p role="status" className="text-sm">Loading the next seven days…</p>}
      {preview.open && preview.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{preview.error}</p>}
      {preview.open && preview.text && <>
        <p className="text-xs text-[var(--color-text-muted)]">This is the exact response for the next seven days with the calendars ticked above. Nothing has been sent.</p>
        <pre tabIndex={0} aria-label="Exact assistant response for calendar availability" className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-[var(--color-border)] p-3 text-xs">{preview.text}</pre>
      </>}
    </div>}
  </fieldset>;
}
