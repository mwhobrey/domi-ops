"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../lib/client-api";
import { apiErrorMessage, type GradeScale, type RecordsSettings } from "../lib/school-records";
import { Alert, Button, Card, CardBody, CardHeader, Input, SectionHeader, Select } from "./ui";

/** Row state keeps the raw text so a half-typed number isn't clobbered mid-edit. */
type Row = { min: string; letter: string; points: string };

const toRows = (scale: GradeScale): Row[] =>
  scale.bands.map((b) => ({ min: String(b.min), letter: b.letter, points: String(b.points) }));

/**
 * Household records settings: the days-of-instruction target and the transcript grade scale.
 * There's no universal scale, so this offers presets and a fully custom one.
 */
export function SchoolRecordsSettings({
  initial,
  onSaved,
}: {
  initial: RecordsSettings;
  onSaved: () => Promise<void>;
}) {
  const [target, setTarget] = useState(initial.schoolDaysTarget == null ? "" : String(initial.schoolDaysTarget));
  const [rows, setRows] = useState<Row[]>(toRows(initial.gradeScale));
  const [passing, setPassing] = useState(String(initial.gradeScale.passingPercent));
  const [isDefault, setIsDefault] = useState(initial.gradeScaleIsDefault);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(false);

  const dirty = () => {
    setSaved(false);
    setTouched(true);
  };

  function applyPreset(id: string) {
    const preset = initial.gradeScalePresets.find((p) => p.id === id);
    if (!preset) return;
    setRows(toRows(preset.scale));
    setPassing(String(preset.scale.passingPercent));
    dirty();
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    dirty();
  }

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.patch<RecordsSettings>("/api/school/settings/records", body);
      setRows(toRows(res.gradeScale));
      setPassing(String(res.gradeScale.passingPercent));
      setIsDefault(res.gradeScaleIsDefault);
      setTarget(res.schoolDaysTarget == null ? "" : String(res.schoolDaysTarget));
      setSaved(true);
      setTouched(false);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save settings"));
    } finally {
      setSaving(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const days = target.trim() === "" ? null : Number(target);
    void save({
      schoolDaysTarget: days,
      gradeScale: {
        passingPercent: Number(passing),
        bands: rows.map((r) => ({ min: Number(r.min), letter: r.letter, points: Number(r.points) })),
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Settings" />
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-6" {...(touched ? { "data-no-auto-refresh": "" } : {})}>
          {error && <Alert variant="error">{error}</Alert>}

          <div className="max-w-xs">
            <label htmlFor="days-target" className="text-label text-[var(--color-text-muted)]">
              Days of instruction required per year
            </label>
            <Input
              id="days-target"
              type="number"
              min="1"
              max="366"
              className="mt-1"
              placeholder="e.g. 180 (leave blank for none)"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                dirty();
              }}
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-label text-[var(--color-text-muted)]">Transcript grade scale</legend>
            <p className="text-sm text-[var(--color-text-muted)]">
              There is no universal scale, so use the one your state, co-op, or college targets expect.
              {isDefault ? " Currently the default." : ""}
            </p>
            <div className="max-w-sm">
              <label htmlFor="scale-preset" className="sr-only">
                Start from a preset
              </label>
              <Select id="scale-preset" className="w-full" defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
                <option value="" disabled>
                  Start from a preset…
                </option>
                {initial.gradeScalePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-left text-sm">
                <thead className="text-label text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Percent from</th>
                    <th className="px-2 py-1 font-medium">Grade</th>
                    <th className="px-2 py-1 font-medium">GPA points</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <Input aria-label={`Grade ${i + 1} percent from`} type="number" min="0" max="100" step="any" className="w-24" value={row.min} onChange={(e) => setRow(i, { min: e.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <Input aria-label={`Grade ${i + 1} label`} maxLength={12} className="w-24" value={row.letter} onChange={(e) => setRow(i, { letter: e.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <Input aria-label={`Grade ${i + 1} GPA points`} type="number" min="0" max="10" step="any" className="w-24" value={row.points} onChange={(e) => setRow(i, { points: e.target.value })} />
                      </td>
                      <td className="py-1 text-right">
                        <Button type="button" variant="ghost" size="sm" aria-label={`Remove grade ${i + 1}`} disabled={rows.length <= 2} onClick={() => { setRows((r) => r.filter((_, idx) => idx !== i)); dirty(); }}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="ghost" size="sm" disabled={rows.length >= 20} onClick={() => { setRows((r) => [...r, { min: "", letter: "", points: "" }]); dirty(); }}>
              <Plus className="h-4 w-4" aria-hidden />
              Add a grade
            </Button>

            <div className="max-w-xs">
              <label htmlFor="passing-percent" className="text-label text-[var(--color-text-muted)]">
                Lowest percent that earns credit
              </label>
              <Input id="passing-percent" type="number" min="0" max="100" step="any" className="mt-1" value={passing} onChange={(e) => { setPassing(e.target.value); dirty(); }} />
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={saving}>
              Save settings
            </Button>
            {!isDefault && (
              <Button type="button" variant="ghost" disabled={saving} onClick={() => void save({ gradeScale: null })}>
                Reset scale to default
              </Button>
            )}
            {saved && (
              <span className="text-xs text-[var(--color-text-muted)]" role="status">
                Saved
              </span>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
