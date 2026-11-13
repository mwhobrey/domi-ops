"use client";

import { useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { capabilityDetails, connectionError, toggleCapability, type CapabilityOption } from "../../lib/mcp";
import { Button, Checkbox } from "../ui";

const previewable = ["shopping.read", "chores.read"];

/** Shows the tool's own response for the member's current data, so the description cannot drift from the code. */
function PayloadPreview({ householdId, capability }: { householdId: string; capability: string }) {
  const [state, setState] = useState<{ open: boolean; loading: boolean; text: string | null; error: string | null }>({ open: false, loading: false, text: null, error: null });
  // Each open or close starts a new turn; a response from an earlier turn is dropped.
  const turn = useRef(0);
  async function toggle() {
    const current = ++turn.current;
    if (state.open) { setState({ ...state, open: false }); return; }
    setState({ open: true, loading: true, text: null, error: null });
    try {
      const result = await apiClient.post<{ payload: unknown }>("/api/mcp-auth/capabilities/preview", { householdId, capability });
      if (turn.current === current) setState({ open: true, loading: false, text: JSON.stringify(result.payload, null, 2), error: null });
    } catch (e) { if (turn.current === current) setState({ open: true, loading: false, text: null, error: connectionError(e) }); }
  }
  return <div className="space-y-2">
    <Button type="button" variant="secondary" aria-expanded={state.open} onClick={() => void toggle()}>{state.open ? "Hide what the assistant receives" : "See what the assistant receives"}</Button>
    {state.open && state.loading && <p role="status" className="text-sm">Loading your current data…</p>}
    {state.open && state.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{state.error}</p>}
    {state.open && state.text && <>
      <p className="text-xs text-[var(--color-text-muted)]">This is the exact response for your household right now, limited to the first three records. Nothing has been sent.</p>
      <pre tabIndex={0} aria-label="Exact assistant response" className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-[var(--color-border)] p-3 text-xs">{state.text}</pre>
    </>}
  </div>;
}

export function CapabilityChoices({ idPrefix, householdId, options, selected, onChange, disabled }: {
  idPrefix: string; householdId: string; options: CapabilityOption[]; selected: string[]; onChange: (names: string[]) => void; disabled: boolean;
}) {
  const reads = options.filter((option) => option.access === "read"), actions = options.filter((option) => option.access === "write");
  // Starts open only when an action is already on; after that the member controls it.
  const [more, setMore] = useState(() => actions.some((option) => selected.includes(option.name)));
  const row = (option: CapabilityOption) => <div key={option.name} className="space-y-2">
    <Checkbox id={`${idPrefix}-${option.name}`} disabled={disabled} checked={selected.includes(option.name)}
      label={capabilityDetails[option.name]?.label ?? option.name}
      onChange={(e) => onChange(toggleCapability(selected, option.name, e.target.checked))} />
    <p className="pl-6 text-sm text-[var(--color-text-muted)]">{capabilityDetails[option.name]?.detail}</p>
    {previewable.includes(option.name) && <div className="pl-6"><PayloadPreview householdId={householdId} capability={option.name} /></div>}
  </div>;
  return <div className="space-y-4">
    {reads.length > 0 && <fieldset className="min-w-0 space-y-4"><legend className="mb-2 text-sm font-medium">What it can read</legend>{reads.map(row)}</fieldset>}
    {!options.length && <p className="text-sm text-[var(--color-text-muted)]">This connection has no optional access. The assistant can only confirm that it is connected.</p>}
    {actions.length > 0 && <details className="rounded-xl border border-[var(--color-border)] p-4" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">More access (off unless you turn it on)</summary>
      <fieldset className="mt-4 min-w-0 space-y-4"><legend className="mb-2 text-sm font-medium">What it can do without asking again</legend>{actions.map(row)}</fieldset>
    </details>}
  </div>;
}
