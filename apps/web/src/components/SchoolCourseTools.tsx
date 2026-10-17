"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "../lib/client-api";
import type { Assignment } from "../lib/school-class-types";
type Change = { id: string; title: string; before: string; after: string };
export function SchoolCourseTools({ classId, assignments, onRescheduled }: { classId: string; assignments: Assignment[]; onRescheduled: (changes: Change[]) => void }) {
  const router = useRouter();
  const [name, setName] = useState(""), [term, setTerm] = useState("");
  const [days, setDays] = useState("7"), [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ timezone: string; changes: Change[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const field = "min-h-11 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-text)]";
  async function reuse() {
    setBusy(true); setError(null);
    try {
      const result = await apiClient.post<{ class: { id: string } }>(`/api/school/classes/${classId}/reuse`, { name, term });
      router.push(`/school/class/${result.class.id}`);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not reuse the course"); }
    finally { setBusy(false); }
  }
  async function reschedule(apply: boolean) {
    setBusy(true); setError(null);
    try {
      const result = await apiClient.post<{ timezone: string; changes: Change[] }>(`/api/school/classes/${classId}/reschedule`, { assignmentIds: selected, days: Number(days), apply,
        ...(apply && preview ? { expected: preview.changes.map(({ id, before, after }) => ({ id, before, after })) } : {}) });
      if (apply) { onRescheduled(result.changes); setPreview(null); setSelected([]); }
      else setPreview(result);
    } catch (e) { setPreview(null); setError(e instanceof ApiError ? e.message : "Could not update the schedule"); }
    finally { setBusy(false); }
  }
  return <details className="mb-4 rounded border border-[var(--color-border)] p-3">
    <summary className="min-h-8 cursor-pointer font-medium">Reuse a course or adjust due dates</summary>
    <div className="mt-3 space-y-4 text-sm">
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void reuse(); }}>
        <p>Copy teaching content into a new class. Assignments start as undated drafts. Rosters, submissions, grades, snapshots and previous schedule are excluded. File and Google links still depend on their original access.</p>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1">New class name<input className={field} required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
          <label className="grid gap-1">New term (optional)<input className={field} maxLength={64} value={term} onChange={(e) => setTerm(e.target.value)} disabled={busy} /></label>
        </div>
        <button className={field} disabled={busy || !name.trim()} type="submit">Create a draft course copy</button>
      </form>
      <form className="space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={(e) => { e.preventDefault(); void reschedule(false); }}>
        <p>Shift selected dated work by calendar days in the household timezone. Work with submitted, graded, returned or excused submissions cannot be shifted here.</p>
        <fieldset disabled={busy} className="max-h-52 space-y-1 overflow-y-auto">
          <legend className="mb-1 font-medium">Assignments to shift</legend>
          {assignments.filter((a) => a.dueAt && a.visibility !== "closed").map((a) => <label key={a.id} className="flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => { setSelected((old) => e.target.checked ? [...old, a.id] : old.filter((id) => id !== a.id)); setPreview(null); }} />
            <span>{a.title}</span>
          </label>)}
        </fieldset>
        <label className="flex flex-wrap items-center gap-2">Days to shift (negative moves earlier)
          <input type="number" min={-366} max={366} required className={`${field} w-24`} value={days} disabled={busy} onChange={(e) => { setDays(e.target.value); setPreview(null); }} />
        </label>
        <button type="submit" className={field} disabled={busy || !selected.length || !Number(days)}>Preview date changes</button>
      </form>
      {preview && <div className="space-y-2" aria-live="polite">
        <p>Review in {preview.timezone}. Applying changes updates due dates for every student in this class.</p>
        <ul className="space-y-2">{preview.changes.map((change) => <li key={change.id}>{change.title}: {new Date(change.before).toLocaleString(undefined, { timeZone: preview.timezone })} → {new Date(change.after).toLocaleString(undefined, { timeZone: preview.timezone })}</li>)}</ul>
        <button type="button" className={field} disabled={busy} onClick={() => void reschedule(true)}>Apply {preview.changes.length} date changes</button>
      </div>}
    </div>
  </details>;
}
