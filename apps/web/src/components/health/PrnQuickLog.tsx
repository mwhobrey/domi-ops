"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import type { NoteShareMember } from "../NoteSharePicker";
import { memberLabel } from "./health-helpers";
import type { HealthMedication } from "./health-types";

/**
 * Top-of-Today quick log for as-needed meds — type or tap, log in one action, no scrolling
 * past the scheduled dose queue to reach the PRN list at the bottom (WHO-296).
 *
 * Shows every visible PRN med, matching the old bottom-of-page card — a med the viewer can't
 * log (read-only segment ACL) still appears, just not as a selectable/loggable row, so it
 * doesn't just disappear off the Today tab for someone who can see it but not act on it.
 */
export function PrnQuickLog({
  meds,
  members,
  canLog,
  logging,
  onLog,
}: {
  meds: HealthMedication[];
  members: NoteShareMember[];
  /** Whether the viewer can log a dose for this med — non-loggable meds still render, read-only. */
  canLog: (med: HealthMedication) => boolean;
  logging?: string | null;
  /** Resolves to whether the log actually succeeded — the input only clears on success. */
  onLog: (medicationId: string) => Promise<boolean>;
}) {
  const id = useId();
  const listId = `${id}-listbox`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = meds.filter((med) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      med.name.toLowerCase().includes(q) ||
      memberLabel(members, med.memberId).toLowerCase().includes(q)
    );
  });
  const loggable = filtered.filter(canLog);
  const showList = open && filtered.length > 0;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function selectMed(med: HealthMedication) {
    if (!canLog(med)) return;
    const ok = await onLog(med.id);
    if (!ok) return; // keep the query/selection so a failed request is easy to retry
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  }

  if (meds.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Log an as-needed med
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        placeholder="Search PRN meds…"
        value={query}
        disabled={Boolean(logging)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList && e.key === "ArrowDown" && loggable.length > 0) {
            setOpen(true);
            setActiveIndex(0);
            e.preventDefault();
            return;
          }
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, loggable.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            void selectMed(loggable[activeIndex]!);
          } else if (e.key === "Escape") {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        className={cn(
          "w-full rounded-[var(--radius-lg)] border bg-[var(--color-surface-elevated)] px-3 py-2 text-sm",
          "border-[var(--color-border)] focus:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        )}
        autoComplete="off"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1 shadow-lg"
        >
          {filtered.map((med) => {
            const medCanLog = canLog(med);
            const activeMed = activeIndex >= 0 ? loggable[activeIndex] : undefined;
            const isActive = medCanLog && activeMed?.id === med.id;
            return (
              <li
                key={med.id}
                id={medCanLog ? `${id}-option-${loggable.indexOf(med)}` : undefined}
                role="option"
                aria-selected={isActive}
                aria-disabled={!medCanLog}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-sm",
                  medCanLog ? "cursor-pointer" : "cursor-default opacity-60",
                  isActive && "bg-[var(--color-accent-subtle)]",
                )}
                onMouseDown={medCanLog ? (e) => e.preventDefault() : undefined}
                onClick={medCanLog ? () => void selectMed(med) : undefined}
                onMouseEnter={medCanLog ? () => setActiveIndex(loggable.indexOf(med)) : undefined}
              >
                <span>
                  {med.name}
                  {med.dosage?.trim() ? (
                    <span className="text-[var(--color-text-muted)]"> · {med.dosage.trim()}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                  {memberLabel(members, med.memberId)}
                  {medCanLog ? null : " · View only"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
