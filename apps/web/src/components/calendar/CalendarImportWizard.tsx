"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { cn } from "../../lib/cn";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ColorField,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Skeleton,
} from "../ui";

type LinkedOption = {
  id: string;
  googleCalendarId: string;
  summary: string | null;
  backgroundColor: string | null;
  syncEnabled: boolean;
  targetCalendarId: string | null;
  targetCalendarName: string | null;
  importColor: string | null;
};

type TargetCalendar = {
  id: string;
  name: string;
  color: string | null;
};

type MapState = {
  linkedCalendarId: string;
  importEnabled: boolean;
  calendarName: string;
  importColor: string;
};

const STEPS = [
  { id: 1 as const, label: "Sources", hint: "Pick Google calendars" },
  { id: 2 as const, label: "Calendars", hint: "Name & color in whome" },
];

function normalizeName(v: string): string {
  return v.trim().toLowerCase();
}

function WizardStepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <nav aria-label="Import progress" className="mb-7">
      <ol className="flex items-center gap-3 sm:gap-4">
        {STEPS.map((s, idx) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition",
                    done && "bg-[var(--color-success-muted)] text-[var(--color-success)]",
                    active &&
                      "bg-[var(--color-accent)] text-white shadow-[0_0_0_3px_var(--color-accent-subtle)]",
                    !done &&
                      !active &&
                      "border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden /> : s.id}
                </span>
                <div className="min-w-0 hidden sm:block">
                  <p
                    className={cn(
                      "text-sm font-medium leading-tight",
                      active ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
                    )}
                  >
                    {s.label}
                  </p>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">{s.hint}</p>
                </div>
              </div>
              {idx < STEPS.length - 1 ? (
                <div
                  className={cn(
                    "mx-1 h-px flex-1",
                    done ? "bg-[var(--color-accent)]/50" : "bg-[var(--color-border)]",
                  )}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SourceSelectCard({
  cal,
  selected,
  onToggle,
}: {
  cal: LinkedOption;
  selected: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const title = cal.summary ?? "Untitled calendar";
  const color = cal.backgroundColor ?? "#3b82f6";
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(!selected)}
        className={cn(
          "flex w-full items-start gap-3 rounded-[var(--radius-lg)] border p-4 text-left transition",
          selected
            ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] ring-1 ring-[var(--color-accent)]/35"
            : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]/40 hover:border-[var(--color-text-muted)]/30 hover:bg-[var(--color-surface-muted)]/50",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
            selected
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-surface-elevated)]",
          )}
          aria-hidden
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/10"
              style={{ background: color }}
              aria-hidden
            />
            <span className="truncate font-medium">{title}</span>
          </span>
          {cal.syncEnabled ? (
            <span className="mt-1.5 inline-block text-xs text-[var(--color-text-muted)]">
              Previously imported
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function CalendarMapNavigator({
  calendars,
  index,
  onIndexChange,
}: {
  calendars: LinkedOption[];
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const total = calendars.length;
  const cal = calendars[index];
  if (!cal || total === 0) return null;

  const title = cal.summary ?? "Untitled calendar";
  const dot = cal.backgroundColor ?? "#3b82f6";
  const canPrev = index > 0;
  const canNext = index < total - 1;

  return (
    <div
      className="mb-4 flex items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 p-1.5 sm:gap-2"
      role="navigation"
      aria-label="Calendar mapping navigation"
    >
      <IconButton
        label="Previous calendar"
        disabled={!canPrev}
        className="shrink-0 disabled:pointer-events-none disabled:opacity-35"
        onClick={() => onIndexChange(index - 1)}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </IconButton>
      <div className="min-w-0 flex-1 px-1 text-center">
        <div className="flex items-center justify-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/10"
            style={{ background: dot }}
            aria-hidden
          />
          <p className="truncate text-sm font-semibold">{title}</p>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {index + 1} of {total}
          {total > 1 ? " · use arrow keys" : ""}
        </p>
      </div>
      <IconButton
        label="Next calendar"
        disabled={!canNext}
        className="shrink-0 disabled:pointer-events-none disabled:opacity-35"
        onClick={() => onIndexChange(index + 1)}
      >
        <ChevronRight className="h-5 w-5" aria-hidden />
      </IconButton>
    </div>
  );
}

export function CalendarImportWizard({
  open,
  onClose,
  onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  onCommitted?: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkedOption[]>([]);
  const [targets, setTargets] = useState<TargetCalendar[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mapById, setMapById] = useState<Map<string, MapState>>(new Map());
  const [mapIndex, setMapIndex] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep(1);
    setError(null);
    setPreview(null);
    setMapIndex(0);
    setSelectedIds(new Set());
    setMapById(new Map());
  }, []);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiClient.post("/api/calendar/import/refresh-sources");
      const data = await apiClient.get<{
        linkedCalendars: LinkedOption[];
        targetCalendars: TargetCalendar[];
      }>("/api/calendar/import/options");
      setLinked(data.linkedCalendars);
      setTargets(data.targetCalendars);
      const targetById = new Map(data.targetCalendars.map((t) => [t.id, t]));
      const initialSelected = new Set(
        data.linkedCalendars.filter((c) => c.syncEnabled).map((c) => c.id),
      );
      if (!initialSelected.size && data.linkedCalendars.length) {
        data.linkedCalendars.forEach((c) => initialSelected.add(c.id));
      }
      setSelectedIds(initialSelected);
      const nextMap = new Map<string, MapState>();
      for (const cal of data.linkedCalendars) {
        const defaultName =
          cal.targetCalendarName ??
          (cal.targetCalendarId ? targetById.get(cal.targetCalendarId)?.name : null) ??
          cal.summary ??
          "My calendar";
        nextMap.set(cal.id, {
          linkedCalendarId: cal.id,
          importEnabled: initialSelected.has(cal.id),
          calendarName: defaultName,
          importColor: cal.importColor ?? cal.backgroundColor ?? "#3b82f6",
        });
      }
      setMapById(nextMap);
    } catch (err) {
      const revoked =
        err instanceof ApiError &&
        (err.body?.includes("token_revoked") ||
          err.body?.includes("expired or was revoked"));
      setError(
        revoked
          ? "Google Calendar access expired or was revoked. Reconnect Google in calendar settings, then open this wizard again."
          : "Connect Google Calendar first, then try again.",
      );
      setLinked([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    void loadOptions();
  }, [open, reset, loadOptions]);

  const selectedLinked = useMemo(
    () => linked.filter((c) => selectedIds.has(c.id)),
    [linked, selectedIds],
  );

  useEffect(() => {
    if (!open || step !== 2) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true'], [role='listbox']")
      ) {
        return;
      }
      const total = selectedLinked.length;
      if (total < 2) return;
      e.preventDefault();
      setMapIndex((idx) => {
        if (e.key === "ArrowLeft") return Math.max(0, idx - 1);
        return Math.min(total - 1, idx + 1);
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, step, selectedLinked.length]);

  function defaultMapState(id: string): MapState {
    const source = linked.find((c) => c.id === id);
    const calendarName = source?.targetCalendarName ?? source?.summary ?? "My calendar";
    return {
      linkedCalendarId: id,
      importEnabled: selectedIds.has(id),
      calendarName,
      importColor: source?.importColor ?? source?.backgroundColor ?? "#3b82f6",
    };
  }

  function mapState(id: string): MapState {
    return mapById.get(id) ?? defaultMapState(id);
  }

  function patchMap(id: string, patch: Partial<MapState>) {
    setMapById((prev) => {
      const next = new Map(prev);
      const base = next.get(id) ?? defaultMapState(id);
      next.set(id, { ...base, ...patch });
      return next;
    });
  }

  function setAllSelected(select: boolean) {
    if (select) {
      const all = new Set(linked.map((c) => c.id));
      setSelectedIds(all);
      setMapById((prev) => {
        const next = new Map(prev);
        for (const id of all) {
          const base = next.get(id);
          if (base) next.set(id, { ...base, importEnabled: true });
        }
        return next;
      });
    } else {
      setSelectedIds(new Set());
      setMapById((prev) => {
        const next = new Map(prev);
        for (const [id, state] of next) {
          next.set(id, { ...state, importEnabled: false });
        }
        return next;
      });
    }
  }

  function buildSelections() {
    return selectedLinked.map((cal) => {
      const state = mapState(cal.id);
      const laneName = (
        state.calendarName ||
        cal.targetCalendarName ||
        cal.summary ||
        "Google calendar"
      ).trim();
      const match = targets.find((t) => normalizeName(t.name) === normalizeName(laneName));
      return {
        linkedCalendarId: cal.id,
        importEnabled: state.importEnabled,
        targetCalendarId: match?.id ?? cal.targetCalendarId,
        newCalendarName: match ? undefined : laneName,
        newCalendarColor: state.importColor,
        importColor: state.importColor,
      };
    });
  }

  async function runPreview() {
    setError(null);
    try {
      const res = await apiClient.post<{
        summary: {
          selectedCalendars: number;
          mode: string;
        };
      }>("/api/calendar/import/preview", { selections: buildSelections() });
      const n = res.summary.selectedCalendars;
      setPreview(
        n === 0
          ? "No calendars selected for import."
          : `Ready to import ${n} Google calendar${n === 1 ? "" : "s"} (${res.summary.mode}). Each gets a default “General” category — add more in Calendar settings.`,
      );
    } catch {
      setPreview(null);
    }
  }

  async function commit() {
    setCommitting(true);
    setError(null);
    try {
      await apiClient.post("/api/calendar/import/commit", {
        selections: buildSelections(),
      });
      await onCommitted?.();
      onClose();
    } catch (err) {
      let message = "Import failed — check destination calendar names and try again.";
      if (err instanceof ApiError && err.body) {
        try {
          const body = JSON.parse(err.body) as { message?: string; error?: string };
          if (body.message) message = body.message;
          else if (body.error === "sync_queue_failed") {
            message =
              "Mappings saved but sync could not start. Check that Redis and the worker are running, then use Sync now.";
          } else if (body.error === "target_calendar_required") {
            message =
              "Each imported Google calendar needs a destination name. Pick one from the list or type a new name.";
          }
        } catch {
          /* keep default */
        }
      }
      setError(message);
    } finally {
      setCommitting(false);
    }
  }

  const activeMap = selectedLinked[Math.min(mapIndex, Math.max(0, selectedLinked.length - 1))];
  const selectedCount = selectedIds.size;

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
      <Button
        variant="ghost"
        type="button"
        disabled={step === 1 || committing}
        onClick={() => {
          setStep(1);
          setPreview(null);
        }}
      >
        Back
      </Button>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        {step === 1 ? (
          <Button
            variant="primary"
            type="button"
            disabled={!selectedCount || loading}
            onClick={() => {
              setMapById((prev) => {
                const next = new Map(prev);
                for (const id of selectedIds) {
                  const base = next.get(id);
                  if (base) next.set(id, { ...base, importEnabled: true });
                }
                return next;
              });
              setMapIndex(0);
              setStep(2);
            }}
          >
            Continue
            {selectedCount > 0 ? ` · ${selectedCount}` : ""}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              type="button"
              disabled={!selectedLinked.length || committing}
              onClick={() => void runPreview()}
            >
              Preview
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={committing}
              disabled={!selectedLinked.length}
              onClick={() => void commit()}
            >
              Import
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Google calendars"
      description="Select Google sources and map each to a whome calendar."
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <>
        <WizardStepIndicator step={step} />

        {error ? (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading Google calendars">
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i}>
                  <Skeleton className="h-[4.5rem] w-full rounded-[var(--radius-lg)]" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!loading && step === 1 ? (
          <section aria-labelledby="import-sources-heading">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 id="import-sources-heading" className="text-label">
                  Google calendars
                </h3>
                {selectedCount > 0 ? (
                  <Badge tone="accent">{selectedCount} selected</Badge>
                ) : null}
              </div>
              {linked.length > 0 ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" type="button" onClick={() => setAllSelected(true)}>
                    Select all
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setAllSelected(false)}>
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>

            {!linked.length ? (
              <EmptyState
                title="No Google calendars found"
                description="Connect Google in calendar settings, then open this wizard again."
                icon={<CalendarDays className="h-10 w-10" strokeWidth={1.25} />}
              />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Google sources">
                {linked.map((cal) => (
                  <SourceSelectCard
                    key={cal.id}
                    cal={cal}
                    selected={selectedIds.has(cal.id)}
                    onToggle={(checked) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(cal.id);
                        else next.delete(cal.id);
                        return next;
                      });
                      patchMap(cal.id, { importEnabled: checked });
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {!loading && step === 2 ? (
          <section aria-labelledby="import-map-heading">
            {!selectedLinked.length ? (
              <EmptyState
                title="No calendars selected"
                description="Go back and choose at least one Google source to map."
                action={
                  <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                    Back to sources
                  </Button>
                }
              />
            ) : (
              <>
                <h3 id="import-map-heading" className="sr-only">
                  Map destinations
                </h3>
                <CalendarMapNavigator
                  calendars={selectedLinked}
                  index={Math.min(mapIndex, selectedLinked.length - 1)}
                  onIndexChange={setMapIndex}
                />

                {activeMap ? (
                  <div
                    id={`import-panel-${activeMap.id}`}
                    aria-labelledby="import-map-heading"
                    className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)]/60 px-4 py-4 sm:px-5">
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Creates a whome calendar with a default &ldquo;General&rdquo; category. Add
                        more categories in Calendar settings after import.
                      </p>
                      <Checkbox
                        label={
                          <span>
                            Import events
                            <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">
                              Off saves mapping only — no pull yet
                            </span>
                          </span>
                        }
                        checked={mapState(activeMap.id).importEnabled}
                        onChange={(e) => patchMap(activeMap.id, { importEnabled: e.target.checked })}
                      />
                    </div>

                    <div className="grid gap-5 px-4 py-4 sm:grid-cols-2 sm:px-5">
                      <label className="block text-sm">
                        <span className="font-medium">Destination calendar</span>
                        <Input
                          className="mt-1.5"
                          list="calendar-import-targets"
                          value={mapState(activeMap.id).calendarName}
                          onChange={(e) => patchMap(activeMap.id, { calendarName: e.target.value })}
                          placeholder="e.g. Family, Work…"
                          autoComplete="off"
                          required
                        />
                        <datalist id="calendar-import-targets">
                          {targets.map((t) => (
                            <option key={t.id} value={t.name} />
                          ))}
                        </datalist>
                        <span className="mt-1.5 block text-xs text-[var(--color-text-muted)]">
                          Match an existing calendar or type a new name to create on import.
                        </span>
                      </label>
                      <div className="text-sm">
                        <span className="font-medium">Calendar color</span>
                        <div className="mt-1.5">
                          <ColorField
                            compact
                            ariaLabel="Import calendar color"
                            value={mapState(activeMap.id).importColor}
                            onChange={(hex) => patchMap(activeMap.id, { importColor: hex })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {preview ? (
                  <Alert variant="info" className="mt-4 text-sm">
                    {preview}
                  </Alert>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </>
    </Modal>
  );
}
