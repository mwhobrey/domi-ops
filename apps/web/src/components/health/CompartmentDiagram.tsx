"use client";

import { useState } from "react";
import { compartmentLines, count, rangesLabel } from "./filling-helpers";
import type { SessionCompartment, SessionMedication } from "./filling-types";
import { formatPills } from "./organizer-helpers";

const SHOWN_RANGES = 2;

/**
 * Where one medication goes in the organizer (WHO-428): a box per compartment with the pills it gets over the whole fill,
 * and under it each dose time with the days it applies to. Long lists of days are cut short and open with one tap.
 */
export function CompartmentDiagram({
  compartments,
  medication,
}: {
  compartments: readonly SessionCompartment[];
  medication: Pick<SessionMedication, "placements" | "byCompartment">;
}) {
  const lines = compartmentLines(medication.placements, compartments);
  const pillsIn = new Map(medication.byCompartment.map((c) => [c.compartmentId, c.pills]));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Compartments">
        {[...compartments]
          .sort((a, b) => a.position - b.position)
          .map((c) => {
            const pills = pillsIn.get(c.id);
            return (
              <li
                key={c.id}
                className={
                  "flex min-w-0 flex-col items-center justify-center rounded-lg border px-2 py-3 text-center " +
                  (pills ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]" : "border-dashed border-[var(--color-border)] opacity-60")
                }
              >
                <span className="w-full truncate text-xs text-[var(--color-text-muted)]">{c.name}</span>
                <span className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{pills ? formatPills(pills) : "–"}</span>
                <span className="text-xs text-[var(--color-text-muted)]">{pills ? (pills === 1 ? "pill in all" : "pills in all") : "none"}</span>
              </li>
            );
          })}
      </ul>

      <ul className="space-y-2">
        {lines.map(({ compartment, lines: doseLines }) => (
          <li key={compartment.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
            <p className="font-medium text-[var(--color-text)]">{compartment.name}</p>
            <ul className="mt-1 space-y-1.5">
              {doseLines.map((line) => {
                const key = `${compartment.id}|${line.time}|${line.pills}`;
                const expanded = open.has(key);
                const more = line.ranges.length - SHOWN_RANGES;
                return (
                  <li key={key} className="text-[var(--color-text-muted)]">
                    <span className="tabular-nums text-[var(--color-text)]">{line.time}</span>
                    {" · "}
                    <span className="text-[var(--color-text)]">{formatPills(line.pills)} {line.pills === 1 ? "pill" : "pills"}</span>
                    {" · "}
                    {rangesLabel(expanded ? line.ranges : line.ranges.slice(0, SHOWN_RANGES))}
                    {more > 0 ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggle(key)}
                          className="text-[var(--color-accent)] underline underline-offset-2"
                        >
                          {expanded ? "fewer" : `+${more} more`}
                        </button>
                      </>
                    ) : null}
                    <span className="block text-xs">{count(line.days, "day")}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
