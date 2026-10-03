"use client";

import { Badge, Button, Card, CardBody, SectionHeader } from "../ui";
import { HealthRow } from "./TodayTabRows";
import {
  checkRowValues,
  checkSlotBadge,
  isCheckSlotPending,
  pendingRows,
  summarizeCheckRows,
  type CheckGroupCard,
} from "./health-check-helpers";
import type { CheckSlotRow, HealthEvent } from "./health-types";

/** Stable key for a slot of a check, used for highlighting and for "this one is busy". */
export function checkSlotKey(row: CheckSlotRow): string {
  return `${row.check.id}|${Math.floor(Date.parse(row.slot.scheduledAt) / 60_000)}`;
}

/** The browser's zone, which is the one `X-Client-Timezone` asks the API to compute the day in. */
export function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type Entry =
  | { kind: "row"; at: string; row: CheckSlotRow }
  | { kind: "group"; at: string; card: CheckGroupCard };

type Actions = {
  events: HealthEvent[];
  highlightKeys: ReadonlySet<string>;
  highlightRef?: React.Ref<HTMLDivElement>;
  busyKey: string | null;
  /** May the viewer log / skip / undo this row right now (permission and the "Managing …" confirm). */
  canAct: (row: CheckSlotRow) => boolean;
  onLog: (row: CheckSlotRow) => void;
  onSkip: (row: CheckSlotRow) => void;
  onUndo: (row: CheckSlotRow) => void;
};

/** One slot of one check: where it stands, what was recorded, and what can be done about it. */
function CheckSlotLine({ row, actions, nested = false }: { row: CheckSlotRow; actions: Actions; nested?: boolean }) {
  const key = checkSlotKey(row);
  const pending = isCheckSlotPending(row.slot.status);
  const badge = checkSlotBadge(row.slot.status);
  const eventById = new Map(actions.events.map((e) => [e.id, e]));
  const values = checkRowValues(row.slot.eventId ? eventById.get(row.slot.eventId) : undefined);
  const highlighted = actions.highlightKeys.has(key);
  const busy = actions.busyKey === key;
  const allowed = actions.canAct(row);
  return (
    <HealthRow
      rowRef={highlighted ? actions.highlightRef : undefined}
      highlighted={highlighted}
      overdue={row.slot.status === "overdue"}
      title={row.check.name}
      subtitle={[
        // Inside a group the time is in the group's header.
        nested ? null : formatSlotTime(row.slot.scheduledAt),
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
              <Button size="sm" disabled={busy} onClick={() => actions.onLog(row)}>
                Log
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => actions.onSkip(row)}>
                Skip
              </Button>
            </>
          ) : null}
          {allowed && !pending && row.slot.logId ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => actions.onUndo(row)}>
              {busy ? "…" : "Undo"}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

/**
 * A group's time: "Morning · 8:00 AM" with each member check under it in its own state, and a
 * "Log next" button that walks through whatever is still waiting.
 */
function CheckGroupBlock({
  card,
  actions,
  onLogNext,
  loggingNext,
}: {
  card: CheckGroupCard;
  actions: Actions;
  onLogNext: (rows: CheckSlotRow[]) => void;
  loggingNext: boolean;
}) {
  const waiting = pendingRows(card.rows);
  const actionable = waiting.filter((r) => actions.canAct(r));
  const summary = summarizeCheckRows(card.rows);
  return (
    <div
      className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
      data-testid="check-group-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--color-text)]">
            {card.group.name} · {formatSlotTime(card.scheduledAt)}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {summary.done} of {summary.total} done
            {summary.overdue > 0 ? ` · ${summary.overdue} overdue` : ""}
          </p>
        </div>
        {actionable.length > 0 ? (
          <Button size="sm" disabled={loggingNext} onClick={() => onLogNext(actionable)}>
            {actionable.length === waiting.length && actionable.length === card.rows.length ? "Log all" : "Log next"}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {card.rows.map((row) => (
          <CheckSlotLine key={checkSlotKey(row)} row={row} actions={actions} nested />
        ))}
      </div>
    </div>
  );
}

/**
 * The person's scheduled health checks for today (WHO-391, WHO-390): "BP at 12:05 PM", each with
 * where it stands and what can be done about it. Pending slots offer Log and Skip; answered ones
 * show what was recorded and offer Undo when the answer is an explicit log (a reading that counted
 * on its own has no log to undo; delete or edit the reading instead). Slots a group covers are
 * shown together under the group, as the group's reminder treats them.
 */
export function TodayChecksCard({
  title,
  rows,
  groupCards,
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
  onLogNext,
  loggingNext,
}: {
  title: string;
  /** Slots not covered by a group. */
  rows: CheckSlotRow[];
  groupCards: CheckGroupCard[];
  events: HealthEvent[];
  loading: boolean;
  borderColor: string;
  canAct: (row: CheckSlotRow) => boolean;
  highlightKeys: ReadonlySet<string>;
  highlightRef?: React.Ref<HTMLDivElement>;
  busyKey: string | null;
  onLog: (row: CheckSlotRow) => void;
  onSkip: (row: CheckSlotRow) => void;
  onUndo: (row: CheckSlotRow) => void;
  /** Walk through these rows one log sheet after another. */
  onLogNext: (rows: CheckSlotRow[]) => void;
  loggingNext: boolean;
}) {
  const allRows = [...rows, ...groupCards.flatMap((c) => c.rows)];
  if (!loading && allRows.length === 0) return null;
  const summary = summarizeCheckRows(allRows);
  const actions: Actions = { events, highlightKeys, highlightRef, busyKey, canAct, onLog, onSkip, onUndo };

  const entries: Entry[] = [
    ...rows.map((row): Entry => ({ kind: "row", at: row.slot.scheduledAt, row })),
    ...groupCards.map((card): Entry => ({ kind: "group", at: card.scheduledAt, card })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Card className="overflow-hidden border-l-4" style={{ borderLeftColor: borderColor }}>
      <CardBody className="space-y-4">
        <SectionHeader
          title={title}
          action={
            allRows.length > 0 ? (
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
          <div className="space-y-2">
            {entries.map((entry) =>
              entry.kind === "row" ? (
                <CheckSlotLine key={checkSlotKey(entry.row)} row={entry.row} actions={actions} />
              ) : (
                <CheckGroupBlock
                  key={entry.card.key}
                  card={entry.card}
                  actions={actions}
                  onLogNext={onLogNext}
                  loggingNext={loggingNext}
                />
              ),
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
