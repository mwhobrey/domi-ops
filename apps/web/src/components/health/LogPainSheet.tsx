"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { NoteSharePicker } from "../NoteSharePicker";
import { Alert, Button, Select, Sheet, Textarea } from "../ui";
import { BodyPainMap } from "./BodyPainMap";
import { PAIN_BODY_REGION_LABELS, type PainLogDraft } from "./health-types";
import { draftsToPainLogs, resolveDefaultMemberId } from "./health-helpers";

/**
 * Fast path for the common case — one check-in, logged right now, tapped on the body map.
 * See HealthEventSheet for backdating.
 */
export function LogPainSheet({
  open,
  members,
  currentMemberId,
  writableMemberIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  members: NoteShareMember[];
  currentMemberId: string;
  writableMemberIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const memberChoices = members.filter((m) => writableMemberIds.includes(m.memberId));
  const defaultMemberId = resolveDefaultMemberId(
    currentMemberId,
    memberChoices.length > 0 ? memberChoices : members,
  );
  const [memberId, setMemberId] = useState(defaultMemberId);
  const [entries, setEntries] = useState<PainLogDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"household" | "private">("private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(defaultMemberId);
    setEntries([]);
    setNotes("");
    setVisibility("private");
    setSharedMemberIds([]);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultMemberId]);

  function defaultTitle(): string {
    if (entries.length === 0) return "Pain";
    return entries.map((e) => PAIN_BODY_REGION_LABELS[e.region]).join(", ");
  }

  async function save() {
    if (entries.length === 0) {
      setErr("Tap at least one region on the body map.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/health/events", {
        memberId,
        type: "pain",
        title: defaultTitle(),
        notes: notes.trim() || undefined,
        startedAt: new Date().toISOString(),
        durationKind: "single_day",
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
        painLogs: draftsToPainLogs(entries),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log pain">
      <fieldset className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {(memberChoices.length > 0 ? memberChoices : members).map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <BodyPainMap entries={entries} onChange={setEntries} />
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
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-pain-share"
            hint="Private by default. Share with selected members so they can read this. You and the subject always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || entries.length === 0}>
            Save
          </Button>
        </div>
      </fieldset>
    </Sheet>
  );
}
