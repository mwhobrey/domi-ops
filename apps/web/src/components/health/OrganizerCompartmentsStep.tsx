"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Input } from "../ui";
import type { OrganizerPlan } from "./organizer-types";

type Row = { key: string; id: string | null; name: string };

const MAX = 8;

/**
 * The organizer's compartments, named and in the order they sit (WHO-427). Four are created to begin with; they can
 * be renamed, moved, added to (up to eight) and removed.
 */
export function OrganizerCompartmentsStep({
  plan,
  save,
  onDone,
}: {
  plan: OrganizerPlan;
  save: (patch: Record<string, unknown>) => Promise<string | null>;
  onDone: () => void;
}) {
  const fromPlan = (): Row[] => plan.compartments.map((c) => ({ key: c.id, id: c.id, name: c.name }));
  const [rows, setRows] = useState<Row[]>(fromPlan);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(plan.compartments.map((c) => ({ key: c.id, id: c.id, name: c.name })));
    // The rows are reset when the saved compartments change, not on every edit of a name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.version]);

  const usedBy = (id: string | null) => (id ? Object.entries(plan.timeMap).filter(([, c]) => c === id).map(([t]) => t) : []);

  function move(index: number, by: -1 | 1) {
    setRows((prev) => {
      const next = [...prev];
      const target = index + by;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function submit() {
    setErr(null);
    if (rows.some((r) => !r.name.trim())) return setErr("Give every compartment a name.");
    setBusy(true);
    try {
      const message = await save({ compartments: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim() })) });
      if (message) return setErr(message);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {err ? <Alert variant="error">{err}</Alert> : null}
      <p className="text-sm text-[var(--color-text-muted)]">
        Name the compartments the way the organizer is laid out, in order. The next step says which dose times go in which.
      </p>

      <ul className="space-y-2">
        {rows.map((row, index) => {
          const times = usedBy(row.id);
          return (
            <li key={row.key} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Input
                  value={row.name}
                  onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))}
                  maxLength={40}
                  aria-label={`Compartment ${index + 1} name`}
                  className="min-w-0 flex-1"
                />
                <Button type="button" size="sm" variant="secondary" aria-label={`Move ${row.name || "compartment"} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </Button>
                <Button type="button" size="sm" variant="secondary" aria-label={`Move ${row.name || "compartment"} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`Remove ${row.name || "compartment"}`}
                  disabled={rows.length <= 1}
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                >
                  ✕
                </Button>
              </div>
              {times.length > 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">Holds {times.join(", ")}. Removing it leaves those times without a compartment.</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={rows.length >= MAX}
          onClick={() => setRows((prev) => [...prev, { key: `new-${prev.length}-${Date.now()}`, id: null, name: "" }])}
        >
          + Add a compartment
        </Button>
        {rows.length >= MAX ? <span className="text-xs text-[var(--color-text-muted)]">That is the most an organizer can have.</span> : null}
        <Button type="submit" loading={busy}>
          Save and continue
        </Button>
      </div>
    </form>
  );
}
