"use client";

import { Badge, Button, Card, CardBody, SectionHeader } from "../ui";
import { HealthRow } from "./TodayTabRows";
import { checkRowValues, checkSlotBadge, isCheckSlotPending, summarizeCheckRows } from "./health-check-helpers";
import type { CheckSlotRow, HealthEvent } from "./health-types";

/** Stable key for a slot of a check, used for highlighting and for "this one is busy". */
export function checkSlotKey(row: CheckSlotRow): string {
  return `${row.check.id}|${Math.floor(Date.parse(row.slot.scheduledAt) / 60_000)}`;
}

/** The browser's zone, which is the one `X-Client-Timezone` asks the API to compute the day in. */
export function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The person's scheduled health checks for today (WHO-391): "BP at 12:05 PM", each with where it
 * stands and what can be done about it. Pending slots offer Log and Skip; answered ones show what
 * was recorded and offer Undo when the answer is an explicit log (a reading that counted on its
 * own has no log to undo; delete or edit the reading instead).
 */
export function TodayChecksCard({
  title,
  rows,
  events,
  loading,
  borderColor,
  canAct,
  highlightKeys,
  highlightRef,
  busyKey,
  onLog,
  onSkip,
  onUndo,
}: {
  title: string;
  rows: CheckSlotRow[];
  /** Entries the viewer can see, to show the values behind a done slot. */
  events: HealthEvent[];
  loading: boolean;
  borderColor: string;
  /** May the viewer log / skip / undo this row right now (permission and the "Managing …" confirm). */
  canAct: (row: CheckSlotRow) => boolean;
  highlightKeys: ReadonlySet<string>;
  highlightRef?: React.Ref<HTMLDivElement>;
  busyKey: string | null;
  onLog: (row: CheckSlotRow) => void;
  onSkip: (row: CheckSlotRow) => void;
  onUndo: (row: CheckSlotRow) => void;
}) {
  if (!loading && rows.length === 0) return null;
  const summary = summarizeCheckRows(rows);
  const eventById = new Map(events.map((e) => [e.id, e]));

  return (
    <Card className="overflow-hidden border-l-4" style={{ borderLeftColor: borderColor }}>
      <CardBody className="space-y-4">
        <SectionHeader
          title={title}
          action={
            rows.length > 0 ? (
              <span className="text-sm text-[var(--color-text-muted)]">
                {summary.done} of {summary.total} done
                {summary.overdue > 0 ? ` · ${summary.overdue} overdue` : ""}
              </span>
            ) : undefined
          }
        />
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const key = checkSlotKey(row);
              const pending = isCheckSlotPending(row.slot.status);
              const badge = checkSlotBadge(row.slot.status);
              const values = checkRowValues(row.slot.eventId ? eventById.get(row.slot.eventId) : undefined);
              const highlighted = highlightKeys.has(key);
              const busy = busyKey === key;
              const allowed = canAct(row);
              return (
                <HealthRow
                  key={key}
                  rowRef={highlighted ? highlightRef : undefined}
                  highlighted={highlighted}
                  overdue={row.slot.status === "overdue"}
                  title={row.check.name}
                  subtitle={[
                    formatSlotTime(row.slot.scheduledAt),
                    values,
                    row.slot.source === "event" ? "counted from a reading" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={
                    <div className="flex items-center gap-2">
                      {pending ? null : <Badge tone={badge.tone}>{badge.label}</Badge>}
                      {allowed && pending ? (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => onLog(row)}>
                            Log
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSkip(row)}>
                            Skip
                          </Button>
                        </>
                      ) : null}
                      {allowed && !pending && row.slot.logId ? (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onUndo(row)}>
                          {busy ? "…" : "Undo"}
                        </Button>
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
