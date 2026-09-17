"use client";

import { Button, Input } from "../ui";
import { newFoodLogEntryDraft } from "./health-helpers";
import type { FoodLogEntryDraft } from "./health-types";

export function FoodLogEntriesEditor({
  drafts,
  onChange,
}: {
  drafts: FoodLogEntryDraft[];
  onChange: (drafts: FoodLogEntryDraft[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm">Food items</span>
      <div className="space-y-2">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
          >
            <label className="block space-y-1 text-xs">
              <span className="text-[var(--color-text-muted)]">Food</span>
              <Input
                value={draft.foodName}
                placeholder="Grilled chicken"
                onChange={(e) => {
                  const foodName = e.target.value;
                  onChange(drafts.map((d) => (d.key === draft.key ? { ...d, foodName } : d)));
                }}
              />
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Quantity</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.quantity}
                  onChange={(e) => {
                    const quantity = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, quantity } : d)));
                  }}
                />
              </label>
              <label className="w-24 space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Unit</span>
                <Input
                  value={draft.unit}
                  placeholder="g, cup"
                  onChange={(e) => {
                    const unit = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, unit } : d)));
                  }}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
              >
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Calories</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.calories}
                  onChange={(e) => {
                    const calories = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, calories } : d)));
                  }}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Protein (g)</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.proteinG}
                  onChange={(e) => {
                    const proteinG = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, proteinG } : d)));
                  }}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Carbs (g)</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.carbsG}
                  onChange={(e) => {
                    const carbsG = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, carbsG } : d)));
                  }}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Fat (g)</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.fatG}
                  onChange={(e) => {
                    const fatG = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, fatG } : d)));
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange([...drafts, newFoodLogEntryDraft()])}
      >
        Add item
      </Button>
    </div>
  );
}
