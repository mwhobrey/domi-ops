"use client";

import { useMemo, useState } from "react";
import { Badge, Input } from "../ui";
import { count, filterMedications, rangesLabel, statusView } from "./filling-helpers";
import type { SessionMedication } from "./filling-types";
import { formatPills } from "./organizer-helpers";

/**
 * The medications of a filling session, to pick from in any order (WHO-428): a search box, a switch between
 * "still to do" and everything, and one tap on a medication. Each shows once, however many compartments it goes in,
 * with how much of it is filled.
 */
export function FillingMedicationPicker({
  medications,
  onPick,
}: {
  medications: readonly SessionMedication[];
  onPick: (medicationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"todo" | "all">("all");

  const todo = useMemo(() => medications.filter((m) => m.status === "pending" || m.status === "partial"), [medications]);
  const shown = useMemo(() => filterMedications(only === "todo" ? todo : medications, query), [only, todo, medications, query]);

  return (
    <div className="space-y-3">
      <Input
        type="search"
        aria-label="Search medications"
        placeholder="Search medications"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      <div className="flex gap-1.5" role="group" aria-label="Show">
        {(
          [
            ["all", `All (${medications.length})`],
            ["todo", `Still to fill (${todo.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={only === value}
            onClick={() => setOnly(value)}
            className={
              "rounded-full border px-3 py-1.5 text-sm transition " +
              (only === value
                ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] font-medium text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">
          {query.trim() ? "No medication matches that." : only === "todo" ? "Everything is filled." : "No medications to fill."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {shown.map((m) => {
            const status = statusView(m.status);
            return (
              <li key={m.medicationId}>
                <button
                  type="button"
                  onClick={() => onPick(m.medicationId)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--color-surface-subtle)] focus-visible:bg-[var(--color-surface-subtle)]"
                >
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-[var(--color-text)]">{m.name}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {[m.dosage, `${formatPills(m.totalPills)} pills`, m.status === "partial" ? `${count(m.filledDays, "day")} of ${m.requiredDays} filled` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {m.status === "partial" ? <span className="block text-xs text-[var(--color-warning)]">Still to fill: {rangesLabel(m.missing)}</span> : null}
                  </span>
                  <Badge tone={status.tone} className="shrink-0">
                    {status.label}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
