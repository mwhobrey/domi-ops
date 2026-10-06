"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Badge, Button, Input, Sheet, Spinner, Textarea } from "../ui";
import {
  appointmentDayLabel,
  appointmentErrorMessage,
  appointmentFromConflict,
  appointmentStatus,
  effectLines,
  medicationEffectLine,
  OUTCOME_LABELS,
  outcomeChoices,
} from "./appointment-helpers";
import type { AppointmentDetail, AppointmentOutcome } from "./appointment-types";
import { formatDay } from "./supply-helpers";

/**
 * One fill appointment (WHO-429): what happened to it (done, skipped, missed, moved to another day, or not yet), a note,
 * and, when it was skipped, missed, moved or is overdue, what that affects: how long the pills in the organizers last,
 * which medications would go without before the next fill, and when their refills fall due. The person can then start a
 * filling session, move the appointment, or say they have dealt with it, which stops it being flagged.
 */
export function AppointmentSheet({
  open,
  planId,
  nominalDate,
  canWrite,
  onClose,
  onChanged,
  onStartSession,
}: {
  open: boolean;
  planId: string;
  /** The day the schedule put the appointment on; identifies it even after it was moved. */
  nominalDate: string | null;
  canWrite: boolean;
  onClose: () => void;
  /** An outcome was saved or resolved, so the list behind the sheet needs reloading. */
  onChanged: () => Promise<void> | void;
  /** Start a filling session from this appointment. */
  onStartSession: (nominalDate: string) => void;
}) {
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A reload after a save failed: the appointment on screen is still the one that was saved, so it stays. */
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AppointmentOutcome>("pending");
  const [moveTo, setMoveTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const moveRef = useRef<HTMLDivElement>(null);

  const path = nominalDate ? `/api/health/organizers/${planId}/appointments/${nominalDate}` : null;

  /** Shows an appointment as the server has it, and starts the form from there. */
  const show = useCallback((next: AppointmentDetail) => {
    setDetail(next);
    setOutcome(next.appointment.outcome);
    setMoveTo(next.appointment.rescheduledTo ?? "");
    setNote(next.appointment.note ?? "");
  }, []);

  const latest = useRef(0);
  const load = useCallback(async (background = false) => {
    if (!path) return;
    const mine = ++latest.current;
    if (background) setRefreshError(null);
    try {
      const res = await apiClient.get<AppointmentDetail>(path);
      if (mine !== latest.current) return;
      show(res);
      setLoadError(null);
      setRefreshError(null);
    } catch {
      if (mine !== latest.current) return;
      if (background) setRefreshError("Could not refresh this appointment. What you see was just saved.");
      else setLoadError("Could not load this appointment.");
    }
  }, [path, show]);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setLoadError(null);
    setRefreshError(null);
    setErr(null);
    setNotice(null);
    void load();
  }, [open, load]);

  const a = detail?.appointment ?? null;
  const dirty = a !== null && (outcome !== a.outcome || (outcome === "rescheduled" && moveTo !== (a.rescheduledTo ?? "")) || note.trim() !== (a.note ?? ""));
  const needsDate = outcome === "rescheduled" && !moveTo;

  async function save() {
    if (!a || !path) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await apiClient.put<AppointmentDetail>(path, {
        outcome,
        ...(outcome === "rescheduled" ? { rescheduledTo: moveTo } : {}),
        note: note.trim() || null,
        version: a.version,
      });
      // The history is only on the full read.
      show({ ...res, events: detail?.events ?? [] });
      void load(true);
      setNotice("Saved.");
      void onChanged();
    } catch (e) {
      const current = appointmentFromConflict(e);
      if (current) {
        show({ ...current, events: detail?.events ?? [] });
        void load(true);
      }
      setErr(appointmentErrorMessage(e, "Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (!path) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await apiClient.post<AppointmentDetail>(`${path}/resolve`);
      show({ ...res, events: detail?.events ?? [] });
      void load(true);
      setNotice("Marked as dealt with.");
      void onChanged();
    } catch (e) {
      setErr(appointmentErrorMessage(e, "Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const status = a ? appointmentStatus(a) : null;
  // Filling can start from any appointment that is still to do; the filling screen picks up a session already open.
  const canStart = canWrite && a !== null && (a.outcome === "pending" || a.outcome === "rescheduled") && a.status !== "done";
  const effects = detail?.effects ?? null;
  const lines = effectLines(effects);

  return (
    <Sheet open={open} onClose={onClose} title={a ? `Fill on ${formatDay(a.date)}` : "Fill appointment"}>
      <div className="space-y-4 px-4 py-4 sm:px-6">
        {loadError ? (
          <div className="space-y-3">
            <Alert variant="error">{loadError}</Alert>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : !a ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-muted)]">
            <Spinner /> Loading…
          </div>
        ) : (
          <>
            {err ? <Alert variant="error">{err}</Alert> : null}
            {refreshError ? <Alert variant="error">{refreshError}</Alert> : null}
            {notice ? <Alert variant="success">{notice}</Alert> : null}

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[var(--color-text)]">{appointmentDayLabel(a)}</p>
              {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
            </div>
            {canStart ? (
              <div>
                <Button type="button" onClick={() => onStartSession(a.nominalDate)}>
                  Start filling
                </Button>
              </div>
            ) : null}
            {a.doneBy === "session" ? <p className="text-sm text-[var(--color-text-muted)]">Counted as done because a filling session was finished for it.</p> : null}

            {canWrite ? (
              <fieldset className="space-y-3" disabled={busy}>
                <legend className="text-sm font-medium text-[var(--color-text)]">What happened?</legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What happened?">
                  {outcomeChoices(a).map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={outcome === o}
                      onClick={() => setOutcome(o)}
                      className={
                        "rounded-full border px-3 py-1.5 text-sm transition " +
                        (outcome === o
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] font-medium text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]")
                      }
                    >
                      {OUTCOME_LABELS[o]}
                    </button>
                  ))}
                </div>

                {outcome === "rescheduled" ? (
                  <div ref={moveRef}>
                    <label className="block space-y-1 text-sm">
                      <span>Move it to</span>
                      <Input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
                      <span className="block text-xs text-[var(--color-text-muted)]">Only this appointment moves. The schedule stays as it is.</span>
                    </label>
                  </div>
                ) : null}

                <label className="block space-y-1 text-sm">
                  <span>Note (optional)</span>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
                </label>

                <div className="flex justify-end">
                  <Button type="button" loading={busy} disabled={!dirty || needsDate} onClick={() => void save()}>
                    Save
                  </Button>
                </div>
              </fieldset>
            ) : a.note ? (
              <p className="whitespace-pre-line break-words text-sm text-[var(--color-text-muted)]">{a.note}</p>
            ) : null}

            {effects ? (
              <section className="space-y-2 rounded-lg border border-[var(--color-border)] p-3 text-sm" aria-label="What this affects">
                <h3 className="font-medium text-[var(--color-text)]">What this affects</h3>
                <ul className="space-y-1 text-[var(--color-text-muted)]">
                  {lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {effects.medications.length > 0 ? (
                  <ul className="space-y-1 border-t border-[var(--color-border)] pt-2 text-[var(--color-text-muted)]">
                    {effects.medications.map((m) => (
                      <li key={m.medicationId} className="break-words">
                        {medicationEffectLine(m)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="border-t border-[var(--color-border)] pt-2 text-[var(--color-text-muted)]">No medication would go without pills before the next fill.</p>
                )}

                {canWrite ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {effects.actions.includes("start_session") && !canStart ? (
                      <Button type="button" onClick={() => onStartSession(a.nominalDate)}>
                        Start filling now
                      </Button>
                    ) : null}
                    {effects.actions.includes("reschedule") && outcome !== "rescheduled" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setOutcome("rescheduled");
                          requestAnimationFrame(() => moveRef.current?.scrollIntoView({ block: "center" }));
                        }}
                      >
                        Move it to another day
                      </Button>
                    ) : null}
                    {effects.actions.includes("resolve") ? (
                      <Button type="button" variant="secondary" loading={busy} onClick={() => void resolve()}>
                        I have dealt with this
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {detail && detail.events.length > 0 ? (
              <section className="space-y-1 text-sm" aria-label="History">
                <h3 className="font-medium text-[var(--color-text)]">History</h3>
                <ul className="space-y-0.5 text-[var(--color-text-muted)]">
                  {detail.events.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: {OUTCOME_LABELS[e.fromOutcome]} → {OUTCOME_LABELS[e.toOutcome]}
                      {e.note ? ` (${e.note})` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
