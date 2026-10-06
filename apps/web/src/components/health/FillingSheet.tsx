"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Button, Input, Modal, Sheet, Spinner } from "../ui";
import { FillingMedicationPanel } from "./FillingMedicationPanel";
import { FillingMedicationPicker } from "./FillingMedicationPicker";
import { FillingSummary } from "./FillingSummary";
import { count, fillErrorMessage, isStaleAnswer, progressLabel, rangeLabel, sessionFromConflict } from "./filling-helpers";
import type { SessionDefaults, SessionView } from "./filling-types";
import { parseDays } from "./supply-helpers";

type Notice = { tone: "success" | "info"; text: string };

/**
 * The filling screen (WHO-428): follow the bottle in your hand. Starting (or picking up) the one open session for a
 * person's organizer, choosing medications in any order, saving each as it is done, and finishing. The session lives on
 * the server, so a refresh, another browser or another person's phone shows the same one; whatever the server says has
 * changed replaces what is on screen, with a sentence about why.
 */
export function FillingSheet({
  open,
  planId,
  memberLabelText,
  onClose,
  onChanged,
}: {
  open: boolean;
  planId: string;
  memberLabelText: string;
  onClose: () => void;
  /** Something that supplies read (the estimates, the lists) changed: a fill was saved or undone. */
  onChanged: () => Promise<void> | void;
}) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [defaults, setDefaults] = useState<SessionDefaults | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [startText, setStartText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);

  const base = `/api/health/organizers/${planId}/sessions`;
  const sessionRef = useRef<SessionView | null>(null);
  sessionRef.current = session;

  // Only the latest load may change what is shown.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const current = await apiClient.get<{ session: SessionView | null }>(`${base}/current`);
      if (mine !== latest.current) return;
      if (current.session) {
        const prev = sessionRef.current;
        if (prev && prev.status === "open" && prev.version !== current.session.version) {
          setNotice({ tone: "info", text: "This session was updated from another device." });
        }
        setSession(current.session);
        setDefaults(null);
      } else {
        const d = await apiClient.get<SessionDefaults>(`${base}/defaults`);
        if (mine !== latest.current) return;
        // A session that ended elsewhere shows how it ended (its summary) until closed; a new one can then be started.
        const prev = sessionRef.current;
        if (prev && prev.status === "open") {
          const ended = await apiClient.get<{ session: SessionView }>(`${base}/${prev.id}`);
          if (mine !== latest.current) return;
          setSession(ended.session);
          setSelectedId(null);
          setNotice({ tone: "info", text: "This session was ended on another device." });
        } else if (!prev) {
          setSession(null);
        }
        setDefaults(d);
        setStartText((t) => t || d.coverageStart);
        setLengthText((t) => t || String(d.fillLengthDays));
      }
      setLoadError(null);
    } catch {
      if (mine === latest.current) setLoadError("Could not load the filling session. Check your connection and try again.");
    } finally {
      if (mine === latest.current) setLoaded(true);
    }
  }, [base]);

  useEffect(() => {
    if (!open) return;
    setSession(null);
    setDefaults(null);
    setLoaded(false);
    setSelectedId(null);
    setNotice(null);
    setErr(null);
    setStartText("");
    setLengthText("");
    void load();
  }, [open, load]);

  // Coming back to this tab (or this phone) after filling elsewhere: pick up where the session is now.
  useEffect(() => {
    if (!open) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && !busy) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [open, busy, load]);

  // Changing medication, or saving one, starts at the top: the notice and the first fields are there, not wherever the last list was scrolled to.
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
  }, [selectedId, notice]);

  const selected = session && selectedId ? (session.medications.find((m) => m.medicationId === selectedId) ?? null) : null;

  async function start() {
    const length = parseDays(lengthText, 93);
    if (!startText || length === null || length < 1) return setErr("Pick the first day and a number of days from 1 to 93.");
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<{ session: SessionView; existing: boolean }>(base, { coverageStart: startText, fillLengthDays: length });
      setSession(res.session);
      setNotice(res.existing ? { tone: "info", text: "Someone had already started a session. You are in it." } : null);
    } catch (e) {
      setErr(fillErrorMessage(e, "Could not start the session. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function afterSaved(next: SessionView, message: string) {
    setSession(next);
    setSelectedId(null);
    setNotice({ tone: "success", text: message });
    void onChanged();
  }

  function afterStale(next: SessionView | null, message: string) {
    if (next) setSession(next);
    else void load();
    setNotice({ tone: "info", text: message });
  }

  async function finish() {
    if (!session) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<{ session: SessionView }>(`${base}/${session.id}/finish`, { version: session.version });
      setSession(res.session);
      setSelectedId(null);
      setNotice(null);
      setConfirmFinish(false);
      void onChanged();
    } catch (e) {
      setConfirmFinish(false);
      if (isStaleAnswer(e)) afterStale(sessionFromConflict(e), fillErrorMessage(e, "This session changed. It was reloaded."));
      else setErr(fillErrorMessage(e, "Could not finish the session. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const anyFilled = session ? session.progress.filled + session.progress.partial > 0 : false;
  const pct = session && session.progress.total > 0 ? Math.round(((session.progress.filled + session.progress.partial / 2) / session.progress.total) * 100) : 0;
  const isOpen = session?.status === "open";

  return (
    <Sheet open={open} onClose={onClose} title={`Fill organizer · ${memberLabelText}`} className="max-w-xl">
      <div ref={topRef} className="space-y-4 px-4 py-4 sm:px-6">
        {!loaded ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-muted)]">
            <Spinner /> Loading…
          </div>
        ) : loadError ? (
          <div className="space-y-3">
            <Alert variant="error">{loadError}</Alert>
            <Button
              variant="secondary"
              onClick={() => {
                setLoaded(false);
                void load();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {notice ? (
              <Alert variant={notice.tone === "success" ? "success" : "info"}>
                {notice.text}
              </Alert>
            ) : null}
            {err ? <Alert variant="error">{err}</Alert> : null}

            {!session ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-text-muted)]">
                  A filling session follows you through the bottles: pick a medication, put its pills in, save it, and move on to the next. It keeps
                  your place if you leave and lets someone else carry on from another phone.
                </p>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-[var(--color-text)]">First day to fill</span>
                  <Input type="date" value={startText} onChange={(e) => setStartText(e.target.value)} />
                  {defaults && startText === defaults.coverageStart ? (
                    <span className="block text-xs text-[var(--color-text-muted)]">This is the day after the organizer is already filled to, or today.</span>
                  ) : null}
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-[var(--color-text)]">Days to fill</span>
                  <Input type="text" inputMode="numeric" value={lengthText} onChange={(e) => setLengthText(e.target.value)} maxLength={2} />
                </label>
                <div className="flex justify-end">
                  <Button loading={busy} onClick={() => void start()}>
                    Start filling
                  </Button>
                </div>
              </div>
            ) : !isOpen ? (
              <div className="space-y-4">
                <Alert variant={session.status === "finished" ? "success" : "info"}>
                  {session.status === "finished" ? "Session finished." : "This session was stopped. What was filled stays counted."}
                </Alert>
                <FillingSummary session={session} />
                <div className="flex justify-end">
                  <Button onClick={onClose}>Close</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-[var(--color-text)]">{progressLabel(session.progress)}</span>
                    <span className="text-[var(--color-text-muted)]">
                      {rangeLabel({ from: session.coverageStart, to: session.coverageEnd })} · {count(session.fillLengthDays, "day")}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Filling progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]/60"
                  >
                    <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {session.reviewRequired ? (
                  <Alert variant="info">The instructions changed after this session started (a schedule, amount or compartment). Filling is paused until they are reviewed.</Alert>
                ) : null}

                {selected ? (
                  <FillingMedicationPanel
                    key={`${selected.medicationId}:${session.version}`}
                    planId={planId}
                    session={session}
                    medication={selected}
                    onBack={() => setSelectedId(null)}
                    onSaved={afterSaved}
                    onStale={afterStale}
                  />
                ) : (
                  <>
                    <FillingMedicationPicker
                      medications={session.medications}
                      onPick={(id) => {
                        setNotice(null);
                        setSelectedId(id);
                      }}
                    />
                    <div className="flex justify-end">
                      <Button variant={session.progress.pending + session.progress.partial === 0 ? "primary" : "secondary"} disabled={!anyFilled} onClick={() => setConfirmFinish(true)}>
                        Finish session
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Modal
        open={confirmFinish && session !== null}
        onClose={() => setConfirmFinish(false)}
        title="Finish this session?"
        footer={
          <div className="flex flex-wrap justify-end gap-2 px-6 py-5">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmFinish(false)}>
              Keep filling
            </Button>
            <Button loading={busy} onClick={() => void finish()}>
              Finish session
            </Button>
          </div>
        }
      >
        {session ? <FillingSummary session={session} /> : null}
      </Modal>
    </Sheet>
  );
}
