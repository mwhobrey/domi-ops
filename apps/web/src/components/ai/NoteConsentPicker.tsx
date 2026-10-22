"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { connectionError } from "../../lib/mcp";
import { Button, Checkbox } from "../ui";

export function NoteConsentPicker({ householdId, selected, onChange, disabled }: {
  householdId: string; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [choices, setChoices] = useState<{ id: string; title: string }[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef({ sequence: 0 });
  async function load(query: string) {
    const id = ++request.current.sequence;
    try {
      const result = await apiClient.post<{ notes: { id: string; title: string }[] }>("/api/mcp-auth/notes", { householdId, search: query });
      if (id !== request.current.sequence) return;
      setChoices(result.notes);
      setTitles((previous) => ({ ...previous, ...Object.fromEntries(result.notes.map((n) => [n.id, n.title])) }));
    } catch (e) { if (id === request.current.sequence) setError(connectionError(e)); }
    finally { if (id === request.current.sequence) setLoading(false); }
  }
  useEffect(() => {
    // load() updates state only after its network response, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load("");
    const tracker = request.current;
    return () => { tracker.sequence++; };
    // The household is fixed for this consent. Search runs only on explicit request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="font-medium">Selected notes ({selected.length}/100)</legend>
    <p className="text-sm text-[var(--color-text-muted)]">Nothing is selected by default. Only notes you can read in this household are offered. Note contents go to the assistant when it reads them.</p>
    <div className="flex flex-wrap gap-2">
      <label className="min-w-0 flex-1 text-sm">Find a note
        <input className="mt-1 min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <Button type="button" variant="secondary" className="self-end" disabled={loading} onClick={() => { setLoading(true); setError(null); void load(search); }}>Search notes</Button>
    </div>
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    <div aria-busy={loading} className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-[var(--color-border)] p-3">
      {choices.map((note) => <Checkbox key={note.id} id={"note-" + note.id} label={note.title || "Untitled note"} checked={selected.includes(note.id)}
        disabled={!selected.includes(note.id) && selected.length >= 100}
        onChange={(e) => onChange(e.target.checked ? [...selected, note.id] : selected.filter((id) => id !== note.id))} />)}
      {!loading && !choices.length && <p className="text-sm text-[var(--color-text-muted)]">No matching notes.</p>}
    </div>
    {choices.length === 100 && <p className="text-sm text-[var(--color-text-muted)]">Showing the first 100 matches. Search to find another note.</p>}
    {selected.filter((id) => !choices.some((n) => n.id === id)).map((id) => <Checkbox key={id} id={"selected-" + id} label={titles[id] ?? "Selected note"}
      checked onChange={() => onChange(selected.filter((value) => value !== id))} />)}
  </fieldset>;
}
