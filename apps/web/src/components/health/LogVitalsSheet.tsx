"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import type { CheckLogContext } from "./health-check-helpers";
import { NoteSharePicker } from "../NoteSharePicker";
import { Alert, Button, Select, Sheet, Textarea } from "../ui";
import { VitalsReadingsEditor } from "./VitalsReadingsEditor";
import {
  draftsToReadings,
  readingDraftsForMetrics,
  resolveDefaultMemberId,
} from "./health-helpers";
import type { VitalsReadingDraft } from "./health-types";

/**
 * Fast path for the common case — a few numbers, logged right now. No title, no
 * duration/ongoing, no type picker; timestamp is "now" (use "Add event" with type
 * Vitals for backdating). See HealthEventSheet for the full editor.
 */
export function LogVitalsSheet({
  open,
  members,
  currentMemberId,
  initialMemberId,
  lockMember,
  writableMemberIds,
  checkContext,
  onClose,
  onSaved,
}: {
  open: boolean;
  members: NoteShareMember[];
  currentMemberId: string;
  /** Preselects this member (e.g. whoever the Today tab is showing) instead of the viewer. */
  initialMemberId?: string;
  /** Fixes the member to `initialMemberId` (Today has already confirmed who is being managed). */
  lockMember?: boolean;
  writableMemberIds: string[];
  /** Set when this log is for a slot of a scheduled check: prefills from its template. */
  checkContext?: CheckLogContext;
  onClose: () => void;
  /** The id of the event just created, so a check's slot can be linked to it. */
  onSaved: (eventId?: string) => void;
}) {
  const memberChoices = members.filter((m) => writableMemberIds.includes(m.memberId));
  const defaultMemberId = resolveDefaultMemberId(
    initialMemberId ?? currentMemberId,
    memberChoices.length > 0 ? memberChoices : members,
  );
  const [memberId, setMemberId] = useState(defaultMemberId);
  const [readingDrafts, setReadingDrafts] = useState<VitalsReadingDraft[]>(() =>
    readingDraftsForMetrics(checkContext?.metrics),
  );
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"household" | "private">("private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(defaultMemberId);
    setReadingDrafts(readingDraftsForMetrics(checkContext?.metrics));
    setNotes("");
    setVisibility("private");
    setSharedMemberIds([]);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultMemberId]);

  const readings = draftsToReadings(readingDrafts);

  async function save() {
    if (readings.length === 0) {
      setErr("Add at least one reading.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<{ event?: { id: string } }>("/api/health/events", {
        memberId,
        type: "vitals",
        title: checkContext?.title ?? "Vitals",
        notes: notes.trim() || undefined,
        startedAt: new Date().toISOString(),
        durationKind: "single_day",
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
        readings,
      });
      onSaved(res.event?.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log vitals">
      <fieldset className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        {checkContext ? (
          <p className="text-sm text-[var(--color-text-muted)]">For {checkContext.heading}</p>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={lockMember}>
            {(memberChoices.length > 0 ? memberChoices : members).map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <VitalsReadingsEditor drafts={readingDrafts} onChange={setReadingDrafts} />
        <label className="block space-y-1 text-sm">
          <span>Notes (optional)</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Visibility</span>
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "household" | "private")}
          >
            <option value="private">Private</option>
            <option value="household">Household</option>
          </Select>
        </label>
        {visibility === "private" ? (
          <NoteSharePicker
            members={members}
            currentMemberId={currentMemberId}
            excludeMemberIds={[memberId]}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-vitals-share"
            hint="Private by default. Share with selected members so they can read this. You and the subject always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || readings.length === 0}>
            Save
          </Button>
        </div>
      </fieldset>
    </Sheet>
  );
}

