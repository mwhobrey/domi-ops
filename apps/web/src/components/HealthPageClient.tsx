"use client";

import { Heart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteShareMember } from "./NoteSharePicker";
import type { HealthAclGrants } from "./HealthPeopleAccessPanel";
import { ModuleReportsLink } from "./reports/ModuleReportsLink";
import { HealthEventSheet } from "./health/HealthEventSheet";
import { HealthMedicationSheet } from "./health/HealthMedicationSheet";
import { LogVitalsSheet } from "./health/LogVitalsSheet";
import { HealthRow, MedGroupDoseCard } from "./health/TodayTabRows";
import {
  groupMedsByMember,
  groupPendingDosesByMemberThenTime,
  groupPendingGroupDosesByMember,
  memberLabel,
  mergeTodayEntriesForMember,
  formatEventWhen,
  formatReadingsSummary,
  scheduleKindLabel,
} from "./health/health-helpers";
import {
  EVENT_TYPES,
  type HealthEvent,
  type HealthMedication,
  type MedicationGroupOption,
  type PendingDose,
  type PendingGroupDose,
} from "./health/health-types";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  LinkButton,
  SectionHeader,
} from "./ui";

export function HealthPageClient({
  members,
  currentMemberId,
  householdTimezone,
  initialEventId,
  initialMedicationId,
  initialTakeMedicationId,
  initialTakeScheduledAt,
  pushAction,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  householdTimezone: string;
  initialEventId?: string;
  initialMedicationId?: string;
  /** Dashboard / calendar dose deep-link → Today Taken (WHO-239). */
  initialTakeMedicationId?: string;
  initialTakeScheduledAt?: string;
  /** iOS / no-actions deep-link auto-log (WHO-235). */
  pushAction?: {
    medicationId: string;
    action: string;
    scheduledAt: string;
    token: string;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"today" | "events" | "medications">("today");
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [medications, setMedications] = useState<HealthMedication[]>([]);
  const [groups, setGroups] = useState<MedicationGroupOption[]>([]);
  const [pendingDoses, setPendingDoses] = useState<PendingDose[]>([]);
  const [pendingGroupDoses, setPendingGroupDoses] = useState<PendingGroupDose[]>([]);
  const [prnMeds, setPrnMeds] = useState<HealthMedication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushActionNotice, setPushActionNotice] = useState<string | null>(null);
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [vitalsSheetOpen, setVitalsSheetOpen] = useState(false);
  const [medSheetOpen, setMedSheetOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<HealthEvent | null>(null);
  const [editingMed, setEditingMed] = useState<HealthMedication | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, HealthAclGrants>>({});
  const [loggingAllKey, setLoggingAllKey] = useState<string | null>(null);
  const [expandedGroupDoses, setExpandedGroupDoses] = useState<Set<string>>(new Set());
  const [highlightTakeKey, setHighlightTakeKey] = useState<string | null>(null);
  const pushActionHandled = useRef(false);
  const takeHandled = useRef(false);
  const highlightTakeRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, medsRes, groupsRes, glanceRes, capsRes] = await Promise.all([
        apiClient.get<{ events: HealthEvent[] }>("/api/health/events"),
        apiClient.get<{ medications: HealthMedication[] }>("/api/health/medications"),
        apiClient.get<{ groups: MedicationGroupOption[] }>("/api/health/medication-groups"),
        apiClient.get<{
          pendingDoses: PendingDose[];
          pendingGroupDoses: PendingGroupDose[];
          prnMedications: HealthMedication[];
        }>("/api/health/glance"),
        apiClient.get<{ bySubject: Record<string, HealthAclGrants> }>("/api/health/capabilities"),
      ]);
      setEvents(eventsRes.events);
      setMedications(medsRes.medications);
      setGroups(groupsRes.groups ?? []);
      setPendingDoses(glanceRes.pendingDoses);
      setPendingGroupDoses(glanceRes.pendingGroupDoses ?? []);
      setPrnMeds(glanceRes.prnMedications);
      setCapabilities(capsRes.bySubject ?? {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load health data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!initialEventId) return;
    const ev = events.find((e) => e.id === initialEventId);
    if (ev) {
      setEditingEvent(ev);
      setEventSheetOpen(true);
      setTab("events");
      return;
    }
    if (loading) return;
    void apiClient
      .get<{ event: HealthEvent }>(`/api/health/events/${initialEventId}`)
      .then((res) => {
        setEditingEvent(res.event);
        setEventSheetOpen(true);
        setTab("events");
      })
      .catch(() => {
        setError("Could not open that health event.");
      });
  }, [initialEventId, events, loading]);

  useEffect(() => {
    if (!initialMedicationId || pushAction || initialTakeMedicationId) return;
    const med = medications.find((m) => m.id === initialMedicationId);
    if (med) {
      setEditingMed(med);
      setMedSheetOpen(true);
      setTab("medications");
    }
  }, [initialMedicationId, medications, pushAction, initialTakeMedicationId]);

  useEffect(() => {
    if (!initialTakeMedicationId || pushAction || takeHandled.current) return;
    if (loading) return;
    takeHandled.current = true;
    setTab("today");
    const key = initialTakeScheduledAt
      ? `${initialTakeMedicationId}-${initialTakeScheduledAt}`
      : initialTakeMedicationId;
    setHighlightTakeKey(key);
    router.replace("/health");
  }, [initialTakeMedicationId, initialTakeScheduledAt, pushAction, loading, router]);

  useEffect(() => {
    if (!highlightTakeKey || tab !== "today") return;
    highlightTakeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightTakeKey, tab, pendingDoses]);

  useEffect(() => {
    if (!pushAction || pushActionHandled.current) return;
    pushActionHandled.current = true;
    const status =
      pushAction.action === "skip" || pushAction.action === "skipped" ? "skipped" : "taken";
    void (async () => {
      try {
        await apiClient.post("/api/health/medications/push-action", {
          token: pushAction.token,
          action: status,
        });
        setPushActionNotice(status === "skipped" ? "Dose marked skipped." : "Dose marked taken.");
        setTab("today");
        await load();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? "Could not log dose from notification (link may have expired)."
            : "Could not log dose from notification",
        );
      } finally {
        router.replace("/health");
      }
    })();
  }, [pushAction, load, router]);

  async function logDose(
    medicationId: string,
    opts: { scheduledAt?: string; alsoCreateEvent?: boolean; status?: string },
    options?: { reload?: boolean },
  ): Promise<boolean> {
    try {
      await apiClient.post(`/api/health/medications/${medicationId}/log`, opts);
      if (options?.reload !== false) await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log dose");
      return false;
    }
  }

  async function logAllTaken(groupKey: string, doses: PendingDose[]) {
    const actionable = doses.filter((d) => canLogForMember(d.memberId));
    if (actionable.length === 0 || loggingAllKey) return;
    setError(null);
    setLoggingAllKey(groupKey);
    try {
      // One conflict-safe bulk request, not an N-request loop that could overwrite a dose the
      // user just skipped. `source: "bulk"` server-side leaves already-logged doses alone.
      await apiClient.post("/api/health/doses/batch", {
        entries: actionable.map((d) => ({
          medicationId: d.medicationId,
          scheduledAt: d.scheduledAt,
          status: "taken",
        })),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log doses");
    } finally {
      setLoggingAllKey(null);
    }
  }

  /** Persisted-group "Take all" — one batch request to /medication-groups/:id/log-all. */
  async function logGroupAllTaken(group: PendingGroupDose) {
    const key = `group:${group.groupId}:${group.scheduledAt}`;
    if (loggingAllKey) return;
    setError(null);
    setLoggingAllKey(key);
    try {
      await apiClient.post(`/api/health/medication-groups/${group.groupId}/log-all`, {
        scheduledAt: group.scheduledAt,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log group doses");
    } finally {
      setLoggingAllKey(null);
    }
  }

  function toggleGroupDoseExpanded(key: string) {
    setExpandedGroupDoses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const canAddEvent = members.some((m) => capabilities[m.memberId]?.events === "write");
  const canAddMed = members.some((m) => capabilities[m.memberId]?.medications === "write");

  function canLogForMember(memberId: string) {
    return capabilities[memberId]?.doses === "write";
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {pushActionNotice ? <Alert variant="success">{pushActionNotice}</Alert> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
        {(["today", "events", "medications"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {key === "today" ? "Today" : key === "events" ? "Events" : "Medications"}
          </Button>
        ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/health/sharing" size="sm" variant="secondary">
            Sharing
          </LinkButton>
          <ModuleReportsLink module="health" />
        </div>
      </div>

      {tab === "today" ? (
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-4">
              <SectionHeader title="Scheduled doses" />
              {loading ? (
                <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
              ) : pendingDoses.length === 0 && pendingGroupDoses.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No pending doses today.</p>
              ) : (
                (() => {
                  const adhocByMember = groupPendingDosesByMemberThenTime(pendingDoses);
                  const groupByMember = groupPendingGroupDosesByMember(pendingGroupDoses);
                  const memberIds = [
                    ...new Set([...adhocByMember.map((m) => m.memberId), ...groupByMember.keys()]),
                  ];
                  return memberIds.map((memberId) => {
                    const adhocTimes = adhocByMember.find((m) => m.memberId === memberId)?.times ?? [];
                    const groupDoses = groupByMember.get(memberId) ?? [];
                    const merged = mergeTodayEntriesForMember(adhocTimes, groupDoses);
                    return (
                      <div key={memberId} className="space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">
                          {memberLabel(members, memberId)}
                        </h3>
                        {merged.map((entry) => {
                          if (entry.kind === "group") {
                            const group = entry.group;
                            const doseKey = `group:${group.groupId}:${group.scheduledAt}`;
                            return (
                              <MedGroupDoseCard
                                key={doseKey}
                                group={group}
                                canLog={canLogForMember(group.memberId)}
                                expanded={expandedGroupDoses.has(doseKey)}
                                onToggleExpand={() => toggleGroupDoseExpanded(doseKey)}
                                onTakeAll={() => void logGroupAllTaken(group)}
                                takingAll={loggingAllKey === `group:${group.groupId}:${group.scheduledAt}`}
                                onLogOne={(medicationId, status) =>
                                  void logDose(medicationId, {
                                    scheduledAt: group.scheduledAt,
                                    alsoCreateEvent: false,
                                    status,
                                  })
                                }
                                highlightTakeKey={highlightTakeKey}
                                highlightTakeRef={highlightTakeRef}
                              />
                            );
                          }
                          const timeGroup = entry.timeGroup;
                          const loggable = timeGroup.doses.filter((d) => canLogForMember(d.memberId));
                          const groupKey = `${memberId}:${timeGroup.scheduledTime}`;
                          return (
                            <div key={timeGroup.scheduledTime} className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                                  {timeGroup.label}
                                  {timeGroup.doses.length > 1
                                    ? ` · ${timeGroup.doses.length} meds`
                                    : null}
                                </p>
                                {loggable.length > 1 ? (
                                  <Button
                                    size="sm"
                                    disabled={loggingAllKey !== null}
                                    onClick={() => void logAllTaken(groupKey, loggable)}
                                  >
                                    {loggingAllKey === groupKey ? "Saving…" : "Taken all"}
                                  </Button>
                                ) : null}
                              </div>
                              <ul className="space-y-2">
                                {timeGroup.doses.map((dose) => {
                                  const doseKey = `${dose.medicationId}-${dose.scheduledAt}`;
                                  const highlighted =
                                    highlightTakeKey === doseKey ||
                                    highlightTakeKey === dose.medicationId;
                                  return (
                                    <HealthRow
                                      key={doseKey}
                                      rowRef={highlighted ? highlightTakeRef : undefined}
                                      highlighted={highlighted}
                                      title={dose.name}
                                      subtitle={dose.dosage?.trim() || undefined}
                                      trailing={
                                        canLogForMember(dose.memberId) ? (
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              onClick={() =>
                                                void logDose(dose.medicationId, {
                                                  scheduledAt: dose.scheduledAt,
                                                  alsoCreateEvent: false,
                                                })
                                              }
                                            >
                                              {dose.awaitingFirst ? "Start" : "Taken"}
                                            </Button>
                                            {!dose.awaitingFirst ? (
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() =>
                                                  void logDose(dose.medicationId, {
                                                    scheduledAt: dose.scheduledAt,
                                                    status: "skipped",
                                                  })
                                                }
                                              >
                                                Skip
                                              </Button>
                                            ) : null}
                                          </div>
                                        ) : null
                                      }
                                    />
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <SectionHeader title="As needed (PRN)" />
              {prnMeds.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No as-needed meds.</p>
              ) : (
                groupMedsByMember(prnMeds).map((memberGroup) => (
                  <div key={memberGroup.memberId} className="space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--color-text)]">
                      {memberLabel(members, memberGroup.memberId)}
                    </h3>
                    <ul className="space-y-2">
                      {memberGroup.meds.map((med) => (
                        <HealthRow
                          key={med.id}
                          title={med.name}
                          subtitle={med.dosage?.trim() || "As needed"}
                          trailing={
                            (med.canLog ?? canLogForMember(med.memberId)) ? (
                              <Button size="sm" onClick={() => void logDose(med.id, {})}>
                                Log dose
                              </Button>
                            ) : null
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="space-y-4">
          {canAddEvent ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setVitalsSheetOpen(true)}>
              Log vitals
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingEvent(null);
                setEventSheetOpen(true);
              }}
            >
              Add event
            </Button>
          </div>
          ) : null}
          {events.length === 0 && !loading ? (
            <EmptyState
              icon={<Heart className="h-8 w-8" aria-hidden />}
              title="No health events"
              description="Log sickness, injuries, or appointments."
            />
          ) : (
            events.map((ev) => {
              const when = formatEventWhen(ev);
              return (
              <HealthRow
                key={ev.id}
                title={ev.title}
                subtitle={[
                  EVENT_TYPES.find((t) => t.value === ev.type)?.label ?? ev.type,
                  memberLabel(members, ev.memberId),
                  when,
                  ev.durationKind === "ongoing" && !ev.endedAt ? "Ongoing" : null,
                  ev.type === "vitals" ? formatReadingsSummary(ev.readings) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  ev.visibility === "private" ? <Badge tone="default">Private</Badge> : null
                }
                onClick={() => {
                  setEditingEvent(ev);
                  setEventSheetOpen(true);
                }}
              />
              );
            })
          )}
        </div>
      ) : null}

      {tab === "medications" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LinkButton href="/health/medications" size="sm" variant="secondary">
              Open medication manager
            </LinkButton>
            {canAddMed ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditingMed(null);
                  setMedSheetOpen(true);
                }}
              >
                Add medication
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            This list is for quick edits. Use the medication manager to set up reminder groups and see
            everyone&apos;s schedule at a glance.
          </p>
          {medications.length === 0 && !loading ? (
            <EmptyState
              icon={<Heart className="h-8 w-8" aria-hidden />}
              title="No medications"
              description="Add scheduled or PRN medications."
            />
          ) : (
            medications.map((med) => (
              <HealthRow
                key={med.id}
                title={med.name}
                subtitle={`${scheduleKindLabel(med.scheduleKind)} · ${memberLabel(members, med.memberId)}`}
                trailing={
                  <Badge tone={med.enabled ? "accent" : "default"}>
                    {scheduleKindLabel(med.scheduleKind)}
                  </Badge>
                }
                onClick={() => {
                  setEditingMed(med);
                  setMedSheetOpen(true);
                }}
              />
            ))
          )}
        </div>
      ) : null}

      <HealthEventSheet
        open={eventSheetOpen}
        event={editingEvent}
        members={members}
        currentMemberId={currentMemberId}
        householdTimezone={householdTimezone}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.events === "write")
          .map((m) => m.memberId)}
        readOnly={Boolean(editingEvent && editingEvent.canEdit === false)}
        onClose={() => {
          setEventSheetOpen(false);
          setEditingEvent(null);
          router.replace("/health");
        }}
        onSaved={() => {
          setEventSheetOpen(false);
          setEditingEvent(null);
          void load();
        }}
      />

      <LogVitalsSheet
        open={vitalsSheetOpen}
        members={members}
        currentMemberId={currentMemberId}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.events === "write")
          .map((m) => m.memberId)}
        onClose={() => setVitalsSheetOpen(false)}
        onSaved={() => {
          setVitalsSheetOpen(false);
          void load();
        }}
      />

      <HealthMedicationSheet
        open={medSheetOpen}
        medication={editingMed}
        members={members}
        currentMemberId={currentMemberId}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.medications === "write")
          .map((m) => m.memberId)}
        groups={groups}
        readOnly={Boolean(editingMed && editingMed.canEdit === false)}
        onClose={() => {
          setMedSheetOpen(false);
          setEditingMed(null);
          router.replace("/health");
        }}
        onSaved={() => {
          setMedSheetOpen(false);
          setEditingMed(null);
          void load();
        }}
      />

    </div>
  );
}

