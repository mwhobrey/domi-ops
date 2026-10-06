"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Badge, Button } from "../ui";
import { appointmentDayLabel, appointmentStatus, groupAppointments } from "./appointment-helpers";
import type { Appointment, AppointmentList } from "./appointment-types";

const SHOWN = 3;

/**
 * The fill appointments of one organizer (WHO-429): what needs attention first (overdue, skipped or missed and not dealt
 * with), then the ones coming up, then the recent ones. A row opens the appointment to say what happened to it.
 */
export function OrganizerAppointments({
  planId,
  refreshKey,
  onOpen,
}: {
  planId: string;
  /** Changes when something that can change an appointment (a filling session, an outcome) happened. */
  refreshKey: number;
  onOpen: (nominalDate: string) => void;
}) {
  const [list, setList] = useState<AppointmentList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState({ upcoming: false, recent: false });

  // Only the latest load may change what is shown.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const res = await apiClient.get<AppointmentList>(`/api/health/organizers/${planId}/appointments`);
      if (mine !== latest.current) return;
      setList(res);
      setError(null);
    } catch {
      if (mine === latest.current) setError("Could not load the fill appointments.");
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const groups = useMemo(() => groupAppointments(list?.appointments ?? []), [list]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!list) return <p className="text-sm text-[var(--color-text-muted)]">Loading appointments…</p>;
  if (list.appointments.length === 0) return null;

  const row = (a: Appointment) => {
    const status = appointmentStatus(a);
    return (
      <li key={a.nominalDate}>
        <button
          type="button"
          onClick={() => onOpen(a.nominalDate)}
          className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-[var(--color-surface-subtle)] focus-visible:bg-[var(--color-surface-subtle)]"
        >
          <span className="min-w-0 break-words text-sm text-[var(--color-text)]">{appointmentDayLabel(a)}</span>
          <Badge tone={status.tone} className="shrink-0">
            {status.label}
          </Badge>
        </button>
      </li>
    );
  };

  const section = (title: string, items: Appointment[], key: "upcoming" | "recent" | null) => {
    if (items.length === 0) return null;
    const expanded = key ? showAll[key] : true;
    const shown = expanded ? items : items.slice(0, SHOWN);
    return (
      <div className="space-y-1">
        <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h4>
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">{shown.map(row)}</ul>
        {key && items.length > SHOWN ? (
          <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => ({ ...s, [key]: !s[key] }))}>
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-3" aria-label="Fill appointments">
      <h3 className="text-sm font-medium text-[var(--color-text)]">Fill appointments</h3>
      {section("Needs attention", groups.attention, null)}
      {section("Coming up", groups.upcoming, "upcoming")}
      {section("Earlier", groups.recent, "recent")}
    </div>
  );
}
