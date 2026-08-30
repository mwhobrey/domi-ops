"use client";

import { Badge, Button, ListItem } from "../ui";
import type { PendingGroupDose } from "./health-types";

export function HealthRow({
  title,
  subtitle,
  trailing,
  onClick,
  highlighted,
  rowRef,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  highlighted?: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={rowRef}>
      <ListItem
        as={onClick ? "button" : "div"}
        onClick={onClick}
        className={
          highlighted
            ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]"
            : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="min-w-0 text-left">
            <p className="truncate font-medium text-[var(--color-text)]">{title}</p>
            {subtitle ? (
              <p className="truncate text-sm text-[var(--color-text-muted)]">{subtitle}</p>
            ) : null}
          </div>
          {trailing}
        </div>
      </ListItem>
    </div>
  );
}

export function MedGroupDoseCard({
  group,
  canLog,
  expanded,
  onToggleExpand,
  onTakeAll,
  takingAll,
  onLogOne,
  highlightTakeKey,
  highlightTakeRef,
}: {
  group: PendingGroupDose;
  canLog: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onTakeAll: () => void;
  takingAll: boolean;
  onLogOne: (medicationId: string, status?: "skipped") => void;
  highlightTakeKey: string | null;
  highlightTakeRef: React.Ref<HTMLDivElement>;
}) {
  const pendingCount = group.medications.filter((m) => !m.alreadyLogged).length;
  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{group.name}</p>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            {group.scheduledTimeLabel} · {group.medications.length} meds
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canLog && pendingCount > 1 ? (
            <Button size="sm" disabled={takingAll} onClick={onTakeAll}>
              {takingAll ? "Saving…" : "Take all"}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onToggleExpand}>
            {expanded ? "Hide" : "Show"} meds
          </Button>
        </div>
      </div>
      {expanded ? (
        <ul className="space-y-2 pt-1">
          {group.medications.map((med) => {
            const doseKey = `${med.medicationId}-${group.scheduledAt}`;
            const highlighted = highlightTakeKey === doseKey || highlightTakeKey === med.medicationId;
            return (
              <HealthRow
                key={med.medicationId}
                rowRef={highlighted ? highlightTakeRef : undefined}
                highlighted={highlighted}
                title={med.name}
                subtitle={med.dosage?.trim() || undefined}
                trailing={
                  med.alreadyLogged ? (
                    <Badge tone="success">Logged</Badge>
                  ) : canLog ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => onLogOne(med.medicationId)}>
                        Taken
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onLogOne(med.medicationId, "skipped")}>
                        Skip
                      </Button>
                    </div>
                  ) : null
                }
              />
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

