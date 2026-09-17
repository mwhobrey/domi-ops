"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { NoteSharePicker } from "../NoteSharePicker";
import { Alert, Button, Select, Sheet, Textarea } from "../ui";
import { FoodLogEntriesEditor } from "./FoodLogEntriesEditor";
import {
  defaultMealTitle,
  draftsToFoodLogEntries,
  foodLogEntriesToDrafts,
  resolveDefaultMemberId,
} from "./health-helpers";
import type { FoodLogEntryDraft } from "./health-types";

/**
 * Fast path for the common case — a few food items, logged right now. No title, no
 * duration/ongoing; timestamp is "now" (use "Add event" with type Meal for backdating).
 * See HealthEventSheet for the full editor. Mirrors LogVitalsSheet.
 */
export function LogMealSheet({
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
  const [foodDrafts, setFoodDrafts] = useState<FoodLogEntryDraft[]>(() =>
    foodLogEntriesToDrafts(undefined),
  );
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"household" | "private">("private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(defaultMemberId);
    setFoodDrafts(foodLogEntriesToDrafts(undefined));
    setNotes("");
    setVisibility("private");
    setSharedMemberIds([]);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultMemberId]);

  const foodLogEntries = draftsToFoodLogEntries(foodDrafts);

  async function save() {
    if (foodLogEntries.length === 0) {
      setErr("Add at least one food item.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/health/events", {
        memberId,
        type: "food_intake",
        title: defaultMealTitle(foodDrafts),
        notes: notes.trim() || undefined,
        startedAt: new Date().toISOString(),
        durationKind: "single_day",
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
        foodLogEntries,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log meal">
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
        <FoodLogEntriesEditor drafts={foodDrafts} onChange={setFoodDrafts} />
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
            namePrefix="health-meal-share"
            hint="Private by default. Share with selected members so they can read this. You and the subject always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || foodLogEntries.length === 0}>
            Save
          </Button>
        </div>
      </fieldset>
    </Sheet>
  );
}
