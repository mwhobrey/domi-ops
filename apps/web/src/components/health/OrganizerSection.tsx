"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { Alert, Badge, Button, Card, CardBody, EmptyState, SectionHeader } from "../ui";
import type { HealthMedication } from "./health-types";
import { OrganizerSheet } from "./OrganizerSheet";
import { scheduleSummary, setupChecklist, type GroupLike } from "./organizer-helpers";
import type { OrganizerPlan, OrganizerStep } from "./organizer-types";

const ICON = { ok: "✓", todo: "!", info: "i" } as const;
const TONE = {
  ok: "text-[var(--color-success)]",
  todo: "text-[var(--color-warning)]",
  info: "text-[var(--color-text-muted)]",
} as const;

/**
 * The pill organizer for one person, under Health → Medications (WHO-427): how it is set up, what is still missing
 * before it can be filled, and the way into the setup sheet. Everyone who can see the person's medications can see
 * it; the buttons show for people who can change them.
 */
export function OrganizerSection({
  memberId,
  memberLabelText,
  members,
  medications,
  groups,
  canWrite,
  refreshKey,
  onMedicationsChanged,
}: {
  memberId: string;
  memberLabelText: string;
  members: readonly NoteShareMember[];
  /** This person's medications, as the medication list returned them. */
  medications: readonly HealthMedication[];
  groups: readonly (GroupLike & { id: string })[];
  canWrite: boolean;
  /** Changes when the medications were reloaded, which can change what is missing here. */
  refreshKey: number;
  onMedicationsChanged: () => Promise<void> | void;
}) {
  const [plan, setPlan] = useState<OrganizerPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The person's medications may be partly visible to this viewer without their organizer being: then there is nothing to show. */
  const [forbidden, setForbidden] = useState(false);
  const [sheet, setSheet] = useState<{ step: OrganizerStep } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ plan: OrganizerPlan | null }>(`/api/health/organizers?memberId=${memberId}`);
      setPlan(res.plan);
      setForbidden(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError("Could not load the pill organizer.");
    } finally {
      setLoaded(true);
    }
  }, [memberId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load, refreshKey]);

  const checklist = useMemo(() => (plan ? setupChecklist(plan, medications) : []), [plan, medications]);
  const nameOf = (id: string) => members.find((m) => m.memberId === id)?.label ?? "Someone";
  const hasScheduled = medications.some((m) => m.scheduleKind === "scheduled" && m.enabled);

  if (forbidden) return null;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title="Pill organizer" />
          {canWrite && plan ? (
            <Button size="sm" variant="secondary" onClick={() => setSheet({ step: "schedule" })}>
              Edit
            </Button>
          ) : null}
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}

        {!loaded ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : !plan ? (
          <EmptyState
            title="No pill organizer set up"
            description={
              canWrite
                ? `If ${memberLabelText} fills a pill organizer, set it up here and each fill tells you which pills go in which compartment, and how many days they cover.${hasScheduled ? "" : " It uses medications with fixed times, so add those first."}`
                : `No pill organizer has been set up for ${memberLabelText}.`
            }
            action={
              canWrite ? (
                <Button onClick={() => setSheet({ step: "schedule" })}>Set up a pill organizer</Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-[var(--color-text-muted)]">Fills</dt>
              <dd className="text-[var(--color-text)]">
                {scheduleSummary(plan)} · {plan.fillLengthDays} days each
              </dd>
              <dt className="text-[var(--color-text-muted)]">Compartments</dt>
              <dd className="flex flex-wrap gap-1.5">
                {plan.compartments.map((c) => (
                  <Badge key={c.id}>{c.name}</Badge>
                ))}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Reminders</dt>
              <dd className="text-[var(--color-text)]">
                {plan.caregiverMemberIds.length === 0 ? "No one" : plan.caregiverMemberIds.map(nameOf).join(", ")} at {plan.reminderTime}
              </dd>
            </dl>

            <ul className="space-y-2">
              {checklist.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold ${TONE[item.status]}`}
                  >
                    {ICON[item.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--color-text)]">{item.title}</p>
                    {item.detail ? <p className="break-words text-[var(--color-text-muted)]">{item.detail}</p> : null}
                  </div>
                  {item.step && canWrite ? (
                    <Button size="sm" variant="secondary" onClick={() => setSheet({ step: item.step! })}>
                      Fix
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>

      <OrganizerSheet
        open={sheet !== null}
        memberId={memberId}
        memberLabelText={memberLabelText}
        plan={plan}
        medications={medications}
        groups={groups}
        members={members}
        initialStep={sheet?.step ?? "schedule"}
        onClose={() => {
          setSheet(null);
          void load();
        }}
        onPlanChanged={setPlan}
        onMedicationsChanged={onMedicationsChanged}
      />
    </Card>
  );
}
