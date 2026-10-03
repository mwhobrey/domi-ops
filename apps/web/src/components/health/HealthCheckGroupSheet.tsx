"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { NoteSharePicker } from "../NoteSharePicker";
import { Alert, Button, Checkbox, Input, Select, Sheet } from "../ui";
import {
  MedScheduleEditor,
  medicationToScheduleDraft,
  scheduleDraftToRequestBody,
  type MedScheduleDraft,
} from "./MedScheduleEditor";
import {
  checkErrorMessage,
  checkScheduleSummary,
  dateRangeError,
  endDateHint,
  parseReminderOffsets,
} from "./health-check-form";
import { resolveDefaultMemberId } from "./health-helpers";
import type { HealthCheck, HealthCheckGroup } from "./health-types";

const DEFAULT_TIMES = ["08:00"];

function draftFor(group: HealthCheckGroup | null): MedScheduleDraft {
  if (!group) return { ...medicationToScheduleDraft(null), times: DEFAULT_TIMES };
  return medicationToScheduleDraft({
    scheduleKind: group.scheduleKind === "interval" ? "interval" : "scheduled",
    schedule: group.schedule,
  });
}

/**
 * Bundle one person's checks into a group (WHO-390): the group sends one reminder at its times
 * ("Morning: BP, weight, pain") and shows them together on the Today tab. A check can be in more
 * than one group, each covering different times of its day. The person is fixed once the group
 * exists; the checks in it can change.
 */
export function HealthCheckGroupSheet({
  open,
  group,
  checks,
  members,
  currentMemberId,
  writableMemberIds,
  initialMemberId,
  onClose,
  onSaved,
}: {
  open: boolean;
  group: HealthCheckGroup | null;
  /** Every check the viewer can see; the picker narrows to the group's person. */
  checks: HealthCheck[];
  members: NoteShareMember[];
  currentMemberId: string;
  writableMemberIds: string[];
  initialMemberId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const memberChoices = members.filter((m) => writableMemberIds.includes(m.memberId));
  const choices = memberChoices.length > 0 ? memberChoices : members;
  const defaultMemberId = resolveDefaultMemberId(
    initialMemberId && choices.some((m) => m.memberId === initialMemberId) ? initialMemberId : currentMemberId,
    choices,
  );

  const [memberId, setMemberId] = useState(group?.memberId ?? defaultMemberId);
  const [name, setName] = useState(group?.name ?? "");
  const [scheduleDraft, setScheduleDraft] = useState<MedScheduleDraft>(() => draftFor(group));
  const [startDate, setStartDate] = useState(group?.startDate ?? "");
  const [endDate, setEndDate] = useState(group?.endDate ?? "");
  const [offsetsText, setOffsetsText] = useState((group?.reminderOffsets ?? [0]).join(", "));
  const [enabled, setEnabled] = useState(group?.enabled ?? true);
  const [visibility, setVisibility] = useState<"household" | "private">(group?.visibility ?? "private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>(group?.sharedMemberIds ?? []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set((group?.checks ?? []).map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(group?.memberId ?? defaultMemberId);
    setName(group?.name ?? "");
    setScheduleDraft(draftFor(group));
    setStartDate(group?.startDate ?? "");
    setEndDate(group?.endDate ?? "");
    setOffsetsText((group?.reminderOffsets ?? [0]).join(", "));
    setEnabled(group?.enabled ?? true);
    setVisibility(group?.visibility ?? "private");
    setSharedMemberIds(group?.sharedMemberIds ?? []);
    setSelected(new Set((group?.checks ?? []).map((c) => c.id)));
    setErr(null);
  }, [open, group, defaultMemberId]);

  // Checks belong to one person, so a different person means a different list.
  const eligible = useMemo(() => checks.filter((c) => c.memberId === memberId), [checks, memberId]);
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(eligible.map((c) => c.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [eligible]);

  // Checks already scheduled at this group's times and not yet in it: the usual "these go together".
  const draftTimes = new Set(scheduleDraft.times.map((t) => t.slice(0, 5)).filter(Boolean));
  const matching =
    scheduleDraft.scheduleKind === "scheduled"
      ? eligible.filter(
          (c) =>
            !selected.has(c.id) &&
            c.scheduleKind === "scheduled" &&
            (c.schedule?.times ?? []).some((t) => draftTimes.has(t.slice(0, 5))),
        )
      : [];

  async function save() {
    if (!name.trim()) {
      setErr("Give the group a name.");
      return;
    }
    const scheduleResult = scheduleDraftToRequestBody(scheduleDraft);
    if (!scheduleResult.ok) {
      setErr(scheduleResult.error.replace(/dose/g, "check"));
      return;
    }
    if (scheduleResult.scheduleKind === "scheduled" && scheduleDraft.times.every((t) => !t.trim())) {
      setErr("Add at least one time.");
      return;
    }
    const offsetsResult = parseReminderOffsets(offsetsText);
    if (!offsetsResult.ok) {
      setErr(offsetsResult.error);
      return;
    }
    const rangeError = dateRangeError(startDate, endDate);
    if (rangeError) {
      setErr(rangeError);
      return;
    }

    setBusy(true);
    setErr(null);
    const body = {
      name: name.trim(),
      scheduleKind: scheduleResult.scheduleKind,
      schedule: scheduleResult.schedule,
      reminderOffsets: offsetsResult.offsets,
      startDate: startDate || null,
      endDate: endDate || null,
      enabled,
      visibility,
      sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
    };
    try {
      if (group) {
        await apiClient.patch(`/api/health/check-groups/${group.id}`, body);
        const before = new Set(group.checks.map((c) => c.id));
        for (const id of selected) {
          if (!before.has(id)) await apiClient.post(`/api/health/check-groups/${group.id}/members`, { checkId: id });
        }
        for (const id of before) {
          if (!selected.has(id)) await apiClient.delete(`/api/health/check-groups/${group.id}/members/${id}`);
        }
      } else {
        await apiClient.post("/api/health/check-groups", { ...body, memberId, checkIds: [...selected] });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? checkErrorMessage(e) : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const memberName = members.find((m) => m.memberId === memberId)?.label ?? "Member";
  const hint = endDateHint(endDate);

  return (
    <Sheet open={open} onClose={onClose} title={group ? "Edit group" : "New check group"}>
      <div className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}

        {group ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            For <strong>{memberName}</strong> (can&apos;t be changed after the group is created)
          </p>
        ) : (
          <label className="block space-y-1 text-sm">
            <span>Who is it for?</span>
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {choices.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="block space-y-1 text-sm">
          <span>Group name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning" />
        </label>

        <MedScheduleEditor draft={scheduleDraft} onChange={setScheduleDraft} allowPrn={false} allowDays subject="check" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span>
              Starts <span className="text-[var(--color-text-muted)]">(optional)</span>
            </span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>
              Ends <span className="text-[var(--color-text-muted)]">(optional)</span>
            </span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        {hint ? <p className="text-sm text-[var(--color-text-muted)]">{hint}</p> : null}

        <label className="block space-y-1 text-sm">
          <span>Remind (minutes before each time, comma-separated — 0 = at the time)</span>
          <Input value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} placeholder="0, 15" />
        </label>

        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label="Active (untick to pause)" />

        <label className="block space-y-1 text-sm">
          <span>Visibility</span>
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value as "household" | "private")}>
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
            namePrefix="health-check-group-share"
            hint="Private by default. Share with selected members so they can see this group. You and the person it is for always have access."
          />
        ) : null}

        {matching.length > 0 ? (
          <Alert variant="info">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {matching.length} check{matching.length > 1 ? "s" : ""} for {memberName} already at these times:{" "}
                {matching.map((c) => c.name).join(", ")}.
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => setSelected((prev) => new Set([...prev, ...matching.map((c) => c.id)]))}
              >
                Add all
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <span className="text-sm font-medium text-[var(--color-text)]">Checks in this group</span>
          {eligible.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              {memberName} has no checks yet. Set one up first, then add it here.
            </p>
          ) : (
            <ul className="space-y-1">
              {eligible.map((c) => (
                <li key={c.id}>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                    label={
                      <span>
                        {c.name}
                        <span className="text-[var(--color-text-muted)]">
                          {" · "}
                          {checkScheduleSummary(c)}
                          {c.enabled ? "" : " · paused"}
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-[var(--color-text-muted)]">
            A check only joins the group&apos;s reminder at times they share. At the group&apos;s other times it
            still reminds on its own.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
