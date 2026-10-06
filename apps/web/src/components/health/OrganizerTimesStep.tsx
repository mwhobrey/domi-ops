"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Select } from "../ui";
import { groupTimes, suggestGroupMappings, type GroupLike } from "./organizer-helpers";
import type { OrganizerPlan } from "./organizer-types";

/**
 * Which compartment each dose time goes in (WHO-427). A group named like a compartment ("Morning") can send all of
 * its times there in one tap; any group can be sent to a compartment of your choosing.
 */
export function OrganizerTimesStep({
  plan,
  groups,
  save,
  onDone,
}: {
  plan: OrganizerPlan;
  groups: readonly (GroupLike & { id: string })[];
  save: (patch: Record<string, unknown>) => Promise<string | null>;
  onDone: () => void;
}) {
  const times = useMemo(() => [...new Set([...plan.setup.doseTimes, ...Object.keys(plan.timeMap)])].sort(), [plan.setup.doseTimes, plan.timeMap]);
  const [choice, setChoice] = useState<Record<string, string>>(plan.timeMap);
  const [groupId, setGroupId] = useState("");
  const [groupTarget, setGroupTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setChoice(plan.timeMap);
  }, [plan.version, plan.timeMap]);

  const suggestions = useMemo(() => suggestGroupMappings(groups, plan.compartments, plan.timeMap), [groups, plan.compartments, plan.timeMap]);
  const usable = groups.filter((g) => g.enabled && groupTimes(g).length > 0);
  const name = (id: string | undefined) => plan.compartments.find((c) => c.id === id)?.name;
  const unassigned = times.filter((t) => !choice[t]);

  async function run(patch: Record<string, unknown>, advance = false) {
    setErr(null);
    setBusy(true);
    try {
      const message = await save(patch);
      if (message) return setErr(message);
      if (advance) onDone();
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestions() {
    // One request: every suggested group's times to its compartment, on top of what is already chosen.
    const merged: Record<string, string> = { ...choice };
    for (const s of suggestions) for (const t of s.times) merged[t] = s.compartmentId;
    await run({ timeMap: merged });
  }

  return (
    <div className="space-y-4">
      {err ? <Alert variant="error">{err}</Alert> : null}

      {times.length === 0 ? (
        <Alert variant="info">There are no medications with fixed times to place yet. Add some, or carry on and come back.</Alert>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">Each time of day a pill is taken goes in one compartment.</p>
      )}

      {suggestions.length > 0 ? (
        <Alert variant="info">
          <div className="space-y-2">
            <p>
              {suggestions.length === 1 ? "A group is" : `${suggestions.length} groups are`} named like a compartment:{" "}
              {suggestions.map((s) => `${s.groupName.trim()} (${s.times.join(", ")})`).join("; ")}.
            </p>
            <Button type="button" size="sm" loading={busy} onClick={() => void applySuggestions()}>
              Use {suggestions.length === 1 ? "it" : "them"}
            </Button>
          </div>
        </Alert>
      ) : null}

      {times.length > 0 ? (
        <ul className="space-y-2">
          {times.map((time) => (
            <li key={time} className="flex items-center justify-between gap-3">
              <span className="w-16 shrink-0 font-medium tabular-nums text-[var(--color-text)]">{time}</span>
              <Select
                value={choice[time] ?? ""}
                onChange={(e) =>
                  setChoice((prev) => {
                    const next = { ...prev };
                    if (e.target.value) next[time] = e.target.value;
                    else delete next[time];
                    return next;
                  })
                }
                aria-label={`Compartment for ${time}`}
                className="min-w-0 flex-1"
              >
                <option value="">Not assigned</option>
                {plan.compartments.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      ) : null}

      {usable.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
          <p className="text-sm font-medium text-[var(--color-text)]">Use a group&apos;s times</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Group" className="min-w-0 flex-1">
              <option value="">Choose a group…</option>
              {usable.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({groupTimes(g).join(", ")})
                </option>
              ))}
            </Select>
            <Select value={groupTarget} onChange={(e) => setGroupTarget(e.target.value)} aria-label="Compartment for the group" className="min-w-0 flex-1">
              <option value="">Choose a compartment…</option>
              {plan.compartments.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" variant="secondary" disabled={!groupId || !groupTarget} loading={busy} onClick={() => void run({ assignGroup: { groupId, compartmentId: groupTarget } })}>
              Use
            </Button>
          </div>
        </div>
      ) : null}

      {unassigned.length > 0 ? (
        <p className="text-sm text-[var(--color-warning)]">
          {unassigned.length === 1 ? "1 time has" : `${unassigned.length} times have`} no compartment yet: {unassigned.join(", ")}.
        </p>
      ) : times.length > 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Every time has a compartment{name(choice[times[0]!]) ? ` (${times.map((t) => `${t} → ${name(choice[t])}`).join(", ")})` : ""}.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" loading={busy} onClick={() => void run({ timeMap: choice }, true)}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}
