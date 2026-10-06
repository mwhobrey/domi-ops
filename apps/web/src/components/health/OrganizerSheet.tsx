"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { Alert, Sheet } from "../ui";
import type { HealthMedication } from "./health-types";
import { OrganizerCompartmentsStep } from "./OrganizerCompartmentsStep";
import { OrganizerPeopleStep } from "./OrganizerPeopleStep";
import { OrganizerQuantitiesStep } from "./OrganizerQuantitiesStep";
import { OrganizerScheduleStep } from "./OrganizerScheduleStep";
import { OrganizerTimesStep } from "./OrganizerTimesStep";
import { organizerErrorMessage, planFromConflict, type GroupLike } from "./organizer-helpers";
import { ORGANIZER_STEPS, ORGANIZER_STEP_LABELS, type OrganizerPlan, type OrganizerStep } from "./organizer-types";

/**
 * Setting up (and later changing) a person's pill organizer, one step at a time (WHO-427): schedule, compartments,
 * which times go in which compartment, how many pills, and who is reminded. The first step creates the plan; every
 * step after it saves on its own, so stopping partway keeps what was done and the section shows what is left.
 */
export function OrganizerSheet({
  open,
  memberId,
  memberLabelText,
  plan: initialPlan,
  medications,
  groups,
  members,
  initialStep,
  onClose,
  onPlanChanged,
  onMedicationsChanged,
}: {
  open: boolean;
  memberId: string;
  memberLabelText: string;
  plan: OrganizerPlan | null;
  medications: readonly HealthMedication[];
  groups: readonly (GroupLike & { id: string })[];
  members: readonly NoteShareMember[];
  initialStep: OrganizerStep;
  onClose: () => void;
  /** The plan as it is now, after each change. */
  onPlanChanged: (plan: OrganizerPlan) => void;
  /** Pill amounts were saved on medications, so the medication list needs reloading. */
  onMedicationsChanged: () => Promise<void> | void;
}) {
  const [plan, setPlan] = useState<OrganizerPlan | null>(initialPlan);
  const [step, setStep] = useState<OrganizerStep>(initialStep);
  const [openSession, setOpenSession] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlan(initialPlan);
    setStep(initialPlan ? initialStep : "schedule");
    // Start from what the section has when the sheet opens; after that the sheet keeps its own copy as it saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A filling session in progress is not stopped by a change here, but it will ask for a review before more filling.
  useEffect(() => {
    if (!open || !plan) {
      setOpenSession(false);
      return;
    }
    let cancelled = false;
    apiClient
      .get<{ session: unknown | null }>(`/api/health/organizers/${plan.id}/sessions/current`)
      .then((res) => {
        if (!cancelled) setOpenSession(res.session !== null);
      })
      .catch(() => {
        if (!cancelled) setOpenSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, plan?.id]);

  const accept = useCallback(
    (next: OrganizerPlan) => {
      setPlan(next);
      onPlanChanged(next);
    },
    [onPlanChanged],
  );

  const reloadPlan = useCallback(async () => {
    const res = await apiClient.get<{ plan: OrganizerPlan | null }>(`/api/health/organizers?memberId=${encodeURIComponent(memberId)}`);
    if (res.plan) accept(res.plan);
  }, [memberId, accept]);

  /** Changes the plan; resolves to an error message, or null when it worked. */
  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<string | null> => {
      if (!plan) return "There is no plan yet.";
      try {
        const res = await apiClient.patch<{ plan: OrganizerPlan }>(`/api/health/organizers/${plan.id}`, { version: plan.version, ...patch });
        accept(res.plan);
        return null;
      } catch (e) {
        // Someone changed it first: show their version, so the next try is against the current one.
        const current = planFromConflict(e);
        if (current) accept(current);
        return organizerErrorMessage(e, "Could not save. Try again.");
      }
    },
    [plan, accept],
  );

  const index = ORGANIZER_STEPS.indexOf(step);
  const next = () => {
    const following = ORGANIZER_STEPS[index + 1];
    if (following) setStep(following);
    else onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Pill organizer · ${memberLabelText}`}>
      <div className="space-y-4 px-6 py-4">
        <nav aria-label="Setup steps" className="flex flex-wrap gap-1.5">
          {ORGANIZER_STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              disabled={!plan && s !== "schedule"}
              aria-current={s === step ? "step" : undefined}
              onClick={() => setStep(s)}
              className={
                "rounded-full border px-3 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 " +
                (s === step
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] font-medium text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]")
              }
            >
              {i + 1}. {ORGANIZER_STEP_LABELS[s]}
            </button>
          ))}
        </nav>

        {openSession ? (
          <Alert variant="info">
            A filling session is open. Changes made here do not stop it, but it will ask for a review before more filling, and show what changed.
          </Alert>
        ) : null}

        {step === "schedule" ? (
          <OrganizerScheduleStep memberId={memberId} plan={plan} save={save} onCreated={accept} onDone={next} />
        ) : !plan ? null : step === "compartments" ? (
          <OrganizerCompartmentsStep plan={plan} save={save} onDone={next} />
        ) : step === "times" ? (
          <OrganizerTimesStep plan={plan} groups={groups} save={save} onDone={next} />
        ) : step === "quantities" ? (
          <OrganizerQuantitiesStep
            plan={plan}
            medications={medications}
            onSaved={async () => {
              await onMedicationsChanged();
              await reloadPlan();
            }}
            onDone={next}
          />
        ) : (
          <OrganizerPeopleStep plan={plan} members={members} save={save} onDone={next} />
        )}
      </div>
    </Sheet>
  );
}
