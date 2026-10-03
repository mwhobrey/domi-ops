"use client";

import { useEffect, useState } from "react";
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
  BP_HEART_RATE_PRESET,
  CHECK_TYPE_OPTIONS,
  checkErrorMessage,
  checkTypeLabel,
  dateRangeError,
  emptyTemplateDraft,
  endDateHint,
  orderedMetrics,
  parseReminderOffsets,
  templateDraftToRequest,
  templateToDraft,
  type CheckTemplateDraft,
} from "./health-check-form";
import { resolveDefaultMemberId } from "./health-helpers";
import {
  PAIN_BODY_REGION_LABELS,
  VITALS_METRICS,
  type HealthCheck,
  type HealthEventType,
} from "./health-types";

/**
 * Set up or change a scheduled health check (WHO-389): "log Ally's blood pressure at 8, 12, 4 and
 * 8 for two weeks". The person and the kind of entry are fixed once it is created, because the
 * history of answered times belongs to them; everything else can change.
 */
export function HealthCheckSheet({
  open,
  check,
  members,
  currentMemberId,
  writableMemberIds,
  initialMemberId,
  onClose,
  onSaved,
}: {
  open: boolean;
  check: HealthCheck | null;
  members: NoteShareMember[];
  currentMemberId: string;
  writableMemberIds: string[];
  /** Preselects this person for a new check (e.g. the one whose checks are on screen). */
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

  const [memberId, setMemberId] = useState(check?.memberId ?? defaultMemberId);
  const [eventType, setEventType] = useState<HealthEventType>(check?.eventType ?? "vitals");
  const [name, setName] = useState(check?.name ?? "");
  const [template, setTemplate] = useState<CheckTemplateDraft>(() =>
    check ? templateToDraft(check.template) : emptyTemplateDraft("vitals"),
  );
  const [scheduleDraft, setScheduleDraft] = useState<MedScheduleDraft>(() =>
    check
      ? medicationToScheduleDraft({
          scheduleKind: check.scheduleKind === "interval" ? "interval" : "scheduled",
          schedule: check.schedule,
        })
      : { ...medicationToScheduleDraft(null), times: ["08:00", "12:00", "16:00", "20:00"] },
  );
  const [startDate, setStartDate] = useState(check?.startDate ?? "");
  const [endDate, setEndDate] = useState(check?.endDate ?? "");
  const [offsetsText, setOffsetsText] = useState((check?.reminderOffsets ?? [0]).join(", "));
  const [enabled, setEnabled] = useState(check?.enabled ?? true);
  const [visibility, setVisibility] = useState<"household" | "private">(check?.visibility ?? "private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>(check?.sharedMemberIds ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(check?.memberId ?? defaultMemberId);
    setEventType(check?.eventType ?? "vitals");
    setName(check?.name ?? "");
    setTemplate(check ? templateToDraft(check.template) : emptyTemplateDraft("vitals"));
    setScheduleDraft(
      check
        ? medicationToScheduleDraft({
            scheduleKind: check.scheduleKind === "interval" ? "interval" : "scheduled",
            schedule: check.schedule,
          })
        : { ...medicationToScheduleDraft(null), times: ["08:00", "12:00", "16:00", "20:00"] },
    );
    setStartDate(check?.startDate ?? "");
    setEndDate(check?.endDate ?? "");
    setOffsetsText((check?.reminderOffsets ?? [0]).join(", "));
    setEnabled(check?.enabled ?? true);
    setVisibility(check?.visibility ?? "private");
    setSharedMemberIds(check?.sharedMemberIds ?? []);
    setErr(null);
  }, [open, check, defaultMemberId]);

  function changeType(next: HealthEventType) {
    setEventType(next);
    // Each kind has its own fields, so start them fresh rather than carry readings over to pain.
    setTemplate((prev) => ({ ...emptyTemplateDraft(next), title: prev.title }));
  }

  function toggleMetric(metric: string, on: boolean) {
    setTemplate((prev) => ({
      ...prev,
      metrics: on ? orderedMetrics([...prev.metrics, metric]) : prev.metrics.filter((m) => m !== metric),
    }));
  }

  function toggleRegion(region: string, on: boolean) {
    setTemplate((prev) => ({
      ...prev,
      regions: on ? [...prev.regions, region] : prev.regions.filter((r) => r !== region),
    }));
  }

  async function save() {
    if (!name.trim()) {
      setErr("Give the check a name.");
      return;
    }
    const templateResult = templateDraftToRequest(eventType, template);
    if (!templateResult.ok) {
      setErr(templateResult.error);
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
    const rangeError = dateRangeError(startDate, endDate);
    if (rangeError) {
      setErr(rangeError);
      return;
    }

    setBusy(true);
    setErr(null);
    const body = {
      name: name.trim(),
      template: templateResult.template,
      scheduleKind: scheduleResult.scheduleKind,
      schedule: scheduleResult.schedule,
      reminderOffsets: parseReminderOffsets(offsetsText),
      startDate: startDate || null,
      endDate: endDate || null,
      enabled,
      visibility,
      sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
    };
    try {
      if (check) {
        // The person and the kind of entry cannot change, so they are not sent.
        await apiClient.patch(`/api/health/checks/${check.id}`, body);
      } else {
        await apiClient.post("/api/health/checks", { ...body, memberId, eventType });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? checkErrorMessage(e) : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const hint = endDateHint(endDate);
  const memberName = members.find((m) => m.memberId === memberId)?.label ?? "Member";

  return (
    <Sheet open={open} onClose={onClose} title={check ? "Edit check" : "New check"}>
      <div className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}

        {check ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            For <strong>{memberName}</strong> · {checkTypeLabel(eventType)} (these can&apos;t be changed after
            the check is created)
          </p>
        ) : (
          <>
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
            <label className="block space-y-1 text-sm">
              <span>What should be logged?</span>
              <Select value={eventType} onChange={(e) => changeType(e.target.value as HealthEventType)}>
                {CHECK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}

        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={eventType === "vitals" ? "Ally's blood pressure" : "Name this check"}
          />
        </label>

        {eventType === "vitals" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--color-text)]">Readings to prompt for</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setTemplate((prev) => ({ ...prev, metrics: [...BP_HEART_RATE_PRESET] }))}
              >
                Blood pressure + heart rate
              </Button>
            </div>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {VITALS_METRICS.filter((m) => m.value !== "other").map((m) => (
                <li key={m.value}>
                  <Checkbox
                    checked={template.metrics.includes(m.value)}
                    onChange={(e) => toggleMetric(m.value, e.target.checked)}
                    label={m.label}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {eventType === "pain" ? (
          <div className="space-y-2">
            <span className="text-sm font-medium text-[var(--color-text)]">
              Body regions to start with{" "}
              <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
            </span>
            <ul className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
              {Object.entries(PAIN_BODY_REGION_LABELS).map(([region, label]) => (
                <li key={region}>
                  <Checkbox
                    checked={template.regions.includes(region)}
                    onChange={(e) => toggleRegion(region, e.target.checked)}
                    label={label}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {eventType === "exercise" ? (
          <label className="block space-y-1 text-sm">
            <span>
              Usual activity <span className="text-[var(--color-text-muted)]">(optional)</span>
            </span>
            <Input
              value={template.activity}
              onChange={(e) => setTemplate((prev) => ({ ...prev, activity: e.target.value }))}
              placeholder="Walk"
            />
          </label>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span>
            Title for each entry <span className="text-[var(--color-text-muted)]">(optional)</span>
          </span>
          <Input
            value={template.title}
            onChange={(e) => setTemplate((prev) => ({ ...prev, title: e.target.value }))}
            placeholder={eventType === "vitals" ? "Vitals" : checkTypeLabel(eventType)}
          />
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
            namePrefix="health-check-share"
            hint="Private by default. Share with selected members so they can see this check. You and the person it is for always have access."
          />
        ) : null}

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
