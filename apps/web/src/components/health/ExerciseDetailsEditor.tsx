"use client";

import { Input, Select } from "../ui";
import { EXERCISE_INTENSITIES } from "./health-types";
import type { ExerciseDetailDraft } from "./health-types";

/** One activity per event for now — the schema supports several, this editor doesn't yet. */
export function ExerciseDetailsEditor({
  draft,
  onChange,
}: {
  draft: ExerciseDetailDraft;
  onChange: (draft: ExerciseDetailDraft) => void;
}) {
  function set<K extends keyof ExerciseDetailDraft>(key: K, value: ExerciseDetailDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
      <label className="block space-y-1 text-sm">
        <span>Activity</span>
        <Input
          value={draft.activity}
          onChange={(e) => set("activity", e.target.value)}
          placeholder="Running, strength training, yoga…"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-sm">
          <span>Duration (min)</span>
          <Input
            type="number"
            value={draft.durationMinutes}
            onChange={(e) => set("durationMinutes", e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Intensity</span>
          <Select value={draft.intensity} onChange={(e) => set("intensity", e.target.value)}>
            <option value="">—</option>
            {EXERCISE_INTENSITIES.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Distance</span>
          <Input type="number" value={draft.distance} onChange={(e) => set("distance", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Distance unit</span>
          <Input
            value={draft.distanceUnit}
            onChange={(e) => set("distanceUnit", e.target.value)}
            placeholder="mi, km"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Sets</span>
          <Input type="number" value={draft.sets} onChange={(e) => set("sets", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Reps</span>
          <Input type="number" value={draft.reps} onChange={(e) => set("reps", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Calories</span>
          <Input
            type="number"
            value={draft.caloriesEstimated}
            onChange={(e) => set("caloriesEstimated", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
