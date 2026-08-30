"use client";

import { Button, Input, Select } from "../ui";
import { defaultUnitFor, nextVitalsDraftKey } from "./health-helpers";
import { VITALS_METRICS, type VitalsMetric, type VitalsReadingDraft } from "./health-types";

export function VitalsReadingsEditor({
  drafts,
  onChange,
}: {
  drafts: VitalsReadingDraft[];
  onChange: (drafts: VitalsReadingDraft[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm">Readings</span>
      <div className="space-y-2">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
          >
            <label className="block space-y-1 text-xs">
              <span className="text-[var(--color-text-muted)]">Metric</span>
              <Select
                value={draft.metric}
                onChange={(e) => {
                  const metric = e.target.value as VitalsMetric;
                  onChange(
                    drafts.map((d) =>
                      d.key === draft.key ? { ...d, metric, unit: defaultUnitFor(metric) } : d,
                    ),
                  );
                }}
              >
                {VITALS_METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Value</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.value}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, value } : d)));
                  }}
                />
              </label>
              <label className="w-20 space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Unit</span>
                <Input
                  value={draft.unit}
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
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([
            ...drafts,
            { key: nextVitalsDraftKey(), metric: "weight", value: "", unit: defaultUnitFor("weight") },
          ])
        }
      >
        Add reading
      </Button>
    </div>
  );
}

