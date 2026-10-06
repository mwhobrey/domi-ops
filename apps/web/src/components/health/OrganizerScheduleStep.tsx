"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Button, Input, Select } from "../ui";
import { organizerErrorMessage, planFromConflict } from "./organizer-helpers";
import type { OrganizerPlan, OrganizerScheduleKind } from "./organizer-types";

const todayLocal = () => new Date().toLocaleDateString("en-CA");

/**
 * How often the organizer is filled, how many days a fill covers and when to be reminded (WHO-427). With no plan yet
 * this creates it; otherwise it changes it.
 */
export function OrganizerScheduleStep({
  memberId,
  plan,
  save,
  onCreated,
  onDone,
}: {
  memberId: string;
  plan: OrganizerPlan | null;
  /** Changes the existing plan; resolves to an error message, or null when it worked. */
  save: (patch: Record<string, unknown>) => Promise<string | null>;
  onCreated: (plan: OrganizerPlan) => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<OrganizerScheduleKind>(plan?.scheduleKind ?? "every_n_days");
  const [everyN, setEveryN] = useState(String(plan?.everyN ?? 30));
  const [monthlyDay, setMonthlyDay] = useState(String(plan?.monthlyDay ?? 1));
  const [anchor, setAnchor] = useState(plan?.anchorDate ?? todayLocal());
  const [fillLength, setFillLength] = useState(String(plan?.fillLengthDays ?? 31));
  const [reminder, setReminder] = useState(plan?.reminderTime ?? "09:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!plan) return;
    setKind(plan.scheduleKind);
    setEveryN(String(plan.everyN ?? 30));
    setMonthlyDay(String(plan.monthlyDay ?? 1));
    setAnchor(plan.anchorDate);
    setFillLength(String(plan.fillLengthDays));
    setReminder(plan.reminderTime);
  }, [plan]);

  const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

  async function submit() {
    setErr(null);
    const n = whole(everyN);
    const day = whole(monthlyDay);
    const length = whole(fillLength);
    if (kind === "every_n_days" && !(n >= 1 && n <= 365)) return setErr("Enter a number of days from 1 to 365.");
    if (kind === "monthly_date" && !(day >= 1 && day <= 31)) return setErr("Enter a day of the month from 1 to 31.");
    if (!(length >= 1 && length <= 93)) return setErr("A fill covers 1 to 93 days.");
    if (!anchor) return setErr("Pick the day the schedule starts from.");

    const body = {
      scheduleKind: kind,
      ...(kind === "every_n_days" ? { everyN: n } : { monthlyDay: day }),
      anchorDate: anchor,
      fillLengthDays: length,
      reminderTime: reminder,
    };
    setBusy(true);
    try {
      if (!plan) {
        const res = await apiClient.post<{ plan: OrganizerPlan }>("/api/health/organizers", { memberId, ...body });
        onCreated(res.plan);
      } else {
        const message = await save(body);
        if (message) return setErr(message);
      }
      onDone();
    } catch (e) {
      // Someone else (or another tab) set the organizer up first: carry on with theirs rather than leave a sheet with no plan.
      const existing = !plan ? planFromConflict(e) : null;
      if (existing) {
        onCreated(existing);
        onDone();
        return;
      }
      setErr(organizerErrorMessage(e, "Could not save the schedule. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const scheduleChanged =
    plan !== null &&
    (kind !== plan.scheduleKind ||
      (kind === "every_n_days" ? whole(everyN) !== plan.everyN : whole(monthlyDay) !== plan.monthlyDay) ||
      anchor !== plan.anchorDate);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {err ? <Alert variant="error">{err}</Alert> : null}

      <label className="block space-y-1 text-sm">
        <span>How often do you fill it?</span>
        <Select value={kind} onChange={(e) => setKind(e.target.value as OrganizerScheduleKind)}>
          <option value="every_n_days">Every so many days</option>
          <option value="monthly_date">On a day of the month</option>
        </Select>
      </label>

      {kind === "every_n_days" ? (
        <label className="block space-y-1 text-sm">
          <span>Every how many days</span>
          <Input type="text" inputMode="numeric" value={everyN} onChange={(e) => setEveryN(e.target.value)} maxLength={3} />
        </label>
      ) : (
        <label className="block space-y-1 text-sm">
          <span>Day of the month</span>
          <Input type="text" inputMode="numeric" value={monthlyDay} onChange={(e) => setMonthlyDay(e.target.value)} maxLength={2} />
          <span className="block text-xs text-[var(--color-text-muted)]">In a month that is too short, the last day of that month is used.</span>
        </label>
      )}

      <label className="block space-y-1 text-sm">
        <span>{kind === "every_n_days" ? "Counting from" : "Starting from"}</span>
        <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
      </label>

      <label className="block space-y-1 text-sm">
        <span>Days in one fill</span>
        <Input type="text" inputMode="numeric" value={fillLength} onChange={(e) => setFillLength(e.target.value)} maxLength={2} />
        <span className="block text-xs text-[var(--color-text-muted)]">How many days of pills go into the organizer each time: 31 for a month.</span>
      </label>

      <label className="block space-y-1 text-sm">
        <span>Remind me at</span>
        <Input type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} />
      </label>

      {scheduleChanged ? (
        <Alert variant="info">Changing how often or from when starts the upcoming appointments afresh. Ones before today keep their history.</Alert>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          {plan ? "Save and continue" : "Create and continue"}
        </Button>
      </div>
    </form>
  );
}
