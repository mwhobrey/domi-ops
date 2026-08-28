"use client";

import { useRef } from "react";
import { Button, Input, Select } from "../ui";

/** Duck-typed against both HealthMedication and a medication group — same schedule shape. */
export type ScheduleSource = {
  scheduleKind?: "scheduled" | "prn" | "interval";
  schedule?: {
    times?: string[];
    everyMinutes?: number;
    anchor?: string;
    fixedStartTime?: string;
    intervalFrom?: string;
    stop?: { mode?: string; maxDoses?: number; endTime?: string };
  };
} | null;

export type MedScheduleDraft = {
  scheduleKind: "scheduled" | "prn" | "interval";
  times: string[];
  everyAmount: string;
  everyUnit: "minutes" | "hours" | "days";
  intervalAnchor: "first_taken" | "fixed_start";
  fixedStartTime: string;
  intervalFrom: "last_taken" | "schedule_grid";
  stopMode: "max_doses" | "end_time" | "midnight";
  maxDoses: string;
  endTime: string;
};

export function minutesToAmountUnit(
  everyMinutes: number | undefined,
): { everyAmount: string; everyUnit: MedScheduleDraft["everyUnit"] } {
  if (!everyMinutes) return { everyAmount: "", everyUnit: "hours" };
  if (everyMinutes % (24 * 60) === 0) {
    return { everyAmount: String(everyMinutes / (24 * 60)), everyUnit: "days" };
  }
  if (everyMinutes % 60 === 0) return { everyAmount: String(everyMinutes / 60), everyUnit: "hours" };
  return { everyAmount: String(everyMinutes), everyUnit: "minutes" };
}

export function amountUnitToMinutes(amount: string, unit: MedScheduleDraft["everyUnit"]): number | null {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === "days" ? n * 24 * 60 : unit === "hours" ? n * 60 : n;
}

export function medicationToScheduleDraft(source: ScheduleSource): MedScheduleDraft {
  const { everyAmount, everyUnit } = minutesToAmountUnit(source?.schedule?.everyMinutes);
  return {
    scheduleKind: source?.scheduleKind ?? "scheduled",
    times: source?.schedule?.times?.length ? source.schedule.times : ["08:00"],
    everyAmount,
    everyUnit,
    intervalAnchor: source?.schedule?.anchor === "fixed_start" ? "fixed_start" : "first_taken",
    fixedStartTime: source?.schedule?.fixedStartTime ?? "08:00",
    intervalFrom: source?.schedule?.intervalFrom === "schedule_grid" ? "schedule_grid" : "last_taken",
    stopMode:
      source?.schedule?.stop?.mode === "end_time" || source?.schedule?.stop?.mode === "midnight"
        ? source.schedule.stop.mode
        : "max_doses",
    maxDoses: source?.schedule?.stop?.maxDoses != null ? String(source.schedule.stop.maxDoses) : "",
    endTime: source?.schedule?.stop?.endTime ?? "22:00",
  };
}

/** Validates + shapes a draft into the request body's scheduleKind/schedule fields — same
 *  rules the API (normalizeMedSchedule) re-validates server-side. Returns a client-facing error
 *  string on failure, matching the messages the sheet's save() used to set directly. */
export function scheduleDraftToRequestBody(
  draft: MedScheduleDraft,
):
  | { ok: true; scheduleKind: MedScheduleDraft["scheduleKind"]; schedule: Record<string, unknown> | undefined }
  | { ok: false; error: string } {
  if (draft.scheduleKind === "scheduled") {
    const times = draft.times
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.length >= 5 ? t.slice(0, 5) : t));
    return { ok: true, scheduleKind: "scheduled", schedule: { times } };
  }
  if (draft.scheduleKind === "interval") {
    const everyMinutes = amountUnitToMinutes(draft.everyAmount, draft.everyUnit);
    if (everyMinutes == null) return { ok: false, error: "Enter how often doses repeat" };
    if (draft.stopMode === "max_doses" && (!draft.maxDoses.trim() || Number(draft.maxDoses) < 1)) {
      return { ok: false, error: "Enter max doses per day" };
    }
    return {
      ok: true,
      scheduleKind: "interval",
      schedule: {
        everyMinutes,
        anchor: draft.intervalAnchor,
        fixedStartTime: draft.intervalAnchor === "fixed_start" ? draft.fixedStartTime : undefined,
        intervalFrom: draft.intervalFrom,
        stop: {
          mode: draft.stopMode,
          maxDoses: draft.stopMode === "max_doses" ? Number(draft.maxDoses) : undefined,
          endTime: draft.stopMode === "end_time" ? draft.endTime : undefined,
        },
      },
    };
  }
  return { ok: true, scheduleKind: "prn", schedule: undefined };
}

export function MedTimesEditor({
  times,
  onChange,
}: {
  times: string[];
  onChange: (times: string[]) => void;
}) {
  // Stable row ids — keying by value remounts the input on every change and eats focus.
  const rowIdsRef = useRef<string[]>([]);
  if (rowIdsRef.current.length < times.length) {
    for (let i = rowIdsRef.current.length; i < times.length; i++) {
      rowIdsRef.current.push(`med-time-${i}-${Math.random().toString(36).slice(2, 9)}`);
    }
  } else if (rowIdsRef.current.length > times.length) {
    rowIdsRef.current = rowIdsRef.current.slice(0, times.length);
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-[var(--color-text)]">Times</span>
      <ul className="space-y-2">
        {times.map((time, index) => (
          <li key={rowIdsRef.current[index]} className="flex items-center gap-2">
            <Input
              type="time"
              className="flex-1"
              value={time.slice(0, 5)}
              onChange={(e) => {
                const next = [...times];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={times.length <= 1}
              onClick={() => {
                rowIdsRef.current = rowIdsRef.current.filter((_, i) => i !== index);
                onChange(times.filter((_, i) => i !== index));
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...times, "08:00"])}>
        + Add time
      </Button>
    </div>
  );
}

/**
 * Shared schedule-kind + times/interval editor, extracted out of HealthMedicationSheet so both
 * it and the medication-group form can use the same UI/validation. `allowPrn` is false for
 * groups — a PRN group has no shared due time to consolidate around (rejected server-side too).
 */
export function MedScheduleEditor({
  draft,
  onChange,
  allowPrn = true,
}: {
  draft: MedScheduleDraft;
  onChange: (next: MedScheduleDraft) => void;
  allowPrn?: boolean;
}) {
  return (
    <>
      <label className="block space-y-1 text-sm">
        <span>Schedule</span>
        <Select
          value={draft.scheduleKind}
          onChange={(e) =>
            onChange({ ...draft, scheduleKind: e.target.value as MedScheduleDraft["scheduleKind"] })
          }
        >
          <option value="scheduled">Scheduled times</option>
          <option value="interval">Every N (interval)</option>
          {allowPrn ? <option value="prn">PRN (as needed)</option> : null}
        </Select>
      </label>
      {draft.scheduleKind === "scheduled" ? (
        <MedTimesEditor times={draft.times} onChange={(times) => onChange({ ...draft, times })} />
      ) : null}
      {draft.scheduleKind === "interval" ? (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <div className="flex flex-wrap gap-2">
            <label className="block flex-1 space-y-1 text-sm">
              <span>Every</span>
              <Input
                type="number"
                min={1}
                value={draft.everyAmount}
                onChange={(e) => onChange({ ...draft, everyAmount: e.target.value })}
                placeholder="e.g. 3"
              />
            </label>
            <label className="block w-32 space-y-1 text-sm">
              <span>Unit</span>
              <Select
                value={draft.everyUnit}
                onChange={(e) =>
                  onChange({ ...draft, everyUnit: e.target.value as MedScheduleDraft["everyUnit"] })
                }
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </Select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Start</span>
            <Select
              value={draft.intervalAnchor}
              onChange={(e) =>
                onChange({
                  ...draft,
                  intervalAnchor: e.target.value as MedScheduleDraft["intervalAnchor"],
                })
              }
            >
              <option value="first_taken">When first dose is Taken</option>
              <option value="fixed_start">At a set morning time</option>
            </Select>
          </label>
          {draft.intervalAnchor === "fixed_start" ? (
            <label className="block space-y-1 text-sm">
              <span>Start time</span>
              <Input
                type="time"
                value={draft.fixedStartTime}
                onChange={(e) => onChange({ ...draft, fixedStartTime: e.target.value })}
              />
            </label>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span>After that, next due is</span>
            <Select
              value={draft.intervalFrom}
              onChange={(e) =>
                onChange({ ...draft, intervalFrom: e.target.value as MedScheduleDraft["intervalFrom"] })
              }
            >
              <option value="last_taken">Last Taken + interval</option>
              <option value="schedule_grid">Fixed grid from start (even if late)</option>
            </Select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Stop for the day</span>
            <Select
              value={draft.stopMode}
              onChange={(e) =>
                onChange({ ...draft, stopMode: e.target.value as MedScheduleDraft["stopMode"] })
              }
            >
              <option value="max_doses">Max doses</option>
              <option value="end_time">After an end time</option>
              <option value="midnight">Local midnight</option>
            </Select>
          </label>
          {draft.stopMode === "max_doses" ? (
            <label className="block space-y-1 text-sm">
              <span>Max doses / day</span>
              <Input
                type="number"
                min={1}
                max={24}
                value={draft.maxDoses}
                onChange={(e) => onChange({ ...draft, maxDoses: e.target.value })}
                placeholder="e.g. 5"
              />
            </label>
          ) : null}
          {draft.stopMode === "end_time" ? (
            <label className="block space-y-1 text-sm">
              <span>End time</span>
              <Input
                type="time"
                value={draft.endTime}
                onChange={(e) => onChange({ ...draft, endTime: e.target.value })}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
