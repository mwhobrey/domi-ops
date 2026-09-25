"use client";

import { Button, Input, Select } from "../ui";
import { defaultUnitFor, nextVitalsDraftKey, vitalsMetricLabel } from "./health-helpers";
import {
  QUICK_ADD_VITALS_METRICS,
  VITALS_METRICS,
  type VitalsMetric,
  type VitalsReadingDraft,
} from "./health-types";

export function VitalsReadingsEditor({
  drafts,
  onChange,
}: {
  drafts: VitalsReadingDraft[];
  onChange: (drafts: VitalsReadingDraft[]) => void;
}) {
  function addReading(metric: VitalsMetric) {
    onChange([...drafts, { key: nextVitalsDraftKey(), metric, value: "", unit: defaultUnitFor(metric) }]);
  }

  const quickAdd = QUICK_ADD_VITALS_METRICS.filter((metric) => !drafts.some((d) => d.metric === metric));

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
      <div className="flex flex-wrap items-center gap-2">
        {quickAdd.map((metric) => (
          <button
            key={metric}
            type="button"
            className="inline-flex min-h-8 items-center rounded-full border border-[var(--color-border)] bg-transparent px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)] max-md:min-h-11 max-md:px-4"
            onClick={() => addReading(metric)}
          >
            + {vitalsMetricLabel(metric)}
          </button>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            addReading(VITALS_METRICS.find((m) => !drafts.some((d) => d.metric === m.value))?.value ?? "other")
          }
        >
          Add reading
        </Button>
      </div>
    </div>
  );
}

