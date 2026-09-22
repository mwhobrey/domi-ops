"use client";

import { useRef } from "react";
import { Button, Input, Select } from "../ui";

export type MilestoneDraft = {
  /** Set only for a milestone that already exists server-side (locked ones always have one). */
  id?: string;
  threshold: string;
  title: string;
  rewardId: string;
  /** Already achieved — server treats these as immutable, so the row renders read-only. */
  locked?: boolean;
};

export type RewardOption = { id: string; title: string };

/**
 * Ordered milestone list editor — modeled on MedTimesEditor (health/MedScheduleEditor.tsx):
 * an in-memory array with Add/Remove/Move buttons, submitted as one array rather than per-row
 * API calls. Already-achieved milestones (locked) render without remove/reorder controls, since
 * the API rejects any change to them once achieved.
 */
export function MilestoneListEditor({
  milestones,
  rewards,
  onChange,
}: {
  milestones: MilestoneDraft[];
  rewards: RewardOption[];
  onChange: (next: MilestoneDraft[]) => void;
}) {
  const rowIdsRef = useRef<string[]>([]);
  if (rowIdsRef.current.length < milestones.length) {
    for (let i = rowIdsRef.current.length; i < milestones.length; i++) {
      rowIdsRef.current.push(`milestone-${i}-${Math.random().toString(36).slice(2, 9)}`);
    }
  } else if (rowIdsRef.current.length > milestones.length) {
    rowIdsRef.current = rowIdsRef.current.slice(0, milestones.length);
  }

  function update(index: number, patch: Partial<MilestoneDraft>) {
    onChange(milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= milestones.length) return;
    if (milestones[index].locked || milestones[target].locked) return;
    const next = [...milestones];
    [next[index], next[target]] = [next[target], next[index]];
    rowIdsRef.current = (() => {
      const ids = [...rowIdsRef.current];
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return ids;
    })();
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-[var(--color-text)]">Milestones</span>
      <p className="text-xs text-[var(--color-text-muted)]">
        Each milestone needs a higher threshold than the one before it. The last milestone
        completes the goal.
      </p>
      <ul className="space-y-2">
        {milestones.map((m, index) => (
          <li
            key={rowIdsRef.current[index]}
            className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
          >
            {m.locked ? (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{m.title}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Threshold {m.threshold} · Achieved
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="Milestone title"
                    value={m.title}
                    onChange={(e) => update(index, { title: e.target.value })}
                    aria-label={`Milestone ${index + 1} title`}
                  />
                  <Input
                    type="number"
                    step="any"
                    className="w-28"
                    placeholder="Threshold"
                    value={m.threshold}
                    onChange={(e) => update(index, { threshold: e.target.value })}
                    aria-label={`Milestone ${index + 1} threshold`}
                  />
                </div>
                <Select
                  value={m.rewardId}
                  onChange={(e) => update(index, { rewardId: e.target.value })}
                  aria-label={`Milestone ${index + 1} reward`}
                >
                  <option value="">No reward</option>
                  {rewards.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => move(index, -1)}>
                    Move up
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => move(index, 1)}>
                    Move down
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={milestones.filter((x) => !x.locked).length <= 1}
                    onClick={() => {
                      rowIdsRef.current = rowIdsRef.current.filter((_, i) => i !== index);
                      onChange(milestones.filter((_, i) => i !== index));
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...milestones, { threshold: "", title: "", rewardId: "" }])}
      >
        + Add milestone
      </Button>
    </div>
  );
}
