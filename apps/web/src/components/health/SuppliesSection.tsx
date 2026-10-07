"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input } from "../ui";
import { CollapsibleHeader } from "./CollapsibleHeader";
import { supplySummary } from "./section-state";
import type { HealthMedication } from "./health-types";
import { SupplyConfirmDialog } from "./SupplyConfirmDialog";
import { SupplySetupSheet } from "./SupplySetupSheet";
import { SupplySheet } from "./SupplySheet";
import {
  canMarkRequested,
  daysLeftLabel,
  formatDay,
  groupBySupply,
  medsNeedingSetup,
  parseDays,
  requestAgeLabel,
  setupDismissKey,
  supplyErrorMessage,
  supplyStatus,
} from "./supply-helpers";

const DEFAULT_LEAD = 7;

/**
 * Supplies for one person, under Health → Medications (WHO-422): every medication with how long it
 * lasts, grouped by the pharmacy that fills it and ordered by what needs attention first. Seeing it needs
 * only access to the medication; the buttons show for medications the caller may change.
 */
export function SuppliesSection({
  memberId,
  memberLabelText,
  medications,
  canWrite,
  onChanged,
  autoPromptMedicationId = null,
  onPromptHandled,
  highlightMedicationId = null,
  onHighlightHandled,
  onEditMedication,
  collapsed,
  onToggleCollapsed,
}: {
  memberId: string;
  memberLabelText: string;
  /** This person's medications, as the medication list returned them (each carries its supply summary). */
  medications: HealthMedication[];
  /** Whether the caller may change this person's medications, and with them their default lead time. */
  canWrite: boolean;
  /** Called after any change, so the medication list (and with it this section) reloads. */
  onChanged: () => void;
  /** A medication that was just resumed: if its estimate now needs confirming, ask about it right away. */
  autoPromptMedicationId?: string | null;
  onPromptHandled?: () => void;
  /** A calendar chip or notice's link: scroll to this medication's supply and mark it for a few seconds. */
  highlightMedicationId?: string | null;
  onHighlightHandled?: () => void;
  /** Open the medication's editor without leaving the supply setup (WHO-446). */
  onEditMedication?: (medicationId: string) => void;
  /** Folded away by the person; the title stays and says what is inside (WHO-447). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [flashId, setFlashId] = useState<string | null>(null);
  const [defaultLead, setDefaultLead] = useState(DEFAULT_LEAD);
  const [editingLead, setEditingLead] = useState(false);
  const [leadText, setLeadText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ mode: "set" | "receive"; medication: HealthMedication } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState<HealthMedication | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loadLead = useCallback(async () => {
    try {
      const res = await apiClient.get<{ defaultLeadDays: number }>(`/api/health/supply-settings/${memberId}`);
      setDefaultLead(res.defaultLeadDays);
    } catch {
      setDefaultLead(DEFAULT_LEAD);
    }
  }, [memberId]);

  useEffect(() => {
    setEditingLead(false);
    void loadLead();
  }, [loadLead]);

  // "Not now" on the setup prompt is remembered per person, in this browser only.
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(setupDismissKey(memberId)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [memberId]);

  function dismissSetup() {
    setDismissed(true);
    try {
      window.localStorage.setItem(setupDismissKey(memberId), "1");
    } catch {
      // not remembered; it will come back next visit
    }
  }

  // Resuming a medication whose estimate predates the pause: ask whether it is still right, once.
  useEffect(() => {
    if (!autoPromptMedicationId) return;
    const med = medications.find((m) => m.id === autoPromptMedicationId);
    if (!med) return;
    if (med.supply?.needsConfirmation) {
      setConfirmError(null);
      setConfirming(med);
    }
    onPromptHandled?.();
  }, [autoPromptMedicationId, medications, onPromptHandled]);

  // A link to one medication's supply: bring it into view and mark it, then let go of the link.
  useEffect(() => {
    if (!highlightMedicationId) return;
    if (!medications.some((m) => m.id === highlightMedicationId)) return;
    setFlashId(highlightMedicationId);
    // The row may render a moment after the medications arrive (the section loads its own settings too), so look for it a few times.
    let tries = 0;
    const look = setInterval(() => {
      const row = document.getElementById(`supply-${highlightMedicationId}`);
      if (row || ++tries >= 20) {
        clearInterval(look);
        // Instant, then once more: the cards below (pharmacies) finish loading and shift the page, which would cut a smooth scroll short.
        const go = () => document.getElementById(`supply-${highlightMedicationId}`)?.scrollIntoView({ block: "center" });
        go();
        setTimeout(go, 800);
      }
    }, 150);
    // No cleanup on purpose: letting go of the link (next line) re-runs this effect, and that must not cancel the scroll or the mark.
    setTimeout(() => setFlashId(null), 5000);
    onHighlightHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMedicationId, medications.length]);

  async function confirmCurrent() {
    const med = confirming;
    if (!med?.supply) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      await apiClient.put(`/api/health/medications/${med.id}/supply`, {
        confirm: true,
        version: med.supply.version,
        idempotencyKey: crypto.randomUUID(),
      });
      setConfirming(null);
      onChanged();
    } catch (e) {
      setConfirmError(supplyErrorMessage(e, "Could not confirm the estimate."));
    } finally {
      setConfirmBusy(false);
    }
  }

  const groups = useMemo(() => groupBySupply(medications), [medications]);
  const needingSetup = useMemo(() => medsNeedingSetup(medications), [medications]);
  const hasAnyEstimate = medications.some((m) => m.supply?.runsOutOn);

  async function act(medication: HealthMedication, run: () => Promise<unknown>, fallback: string) {
    setBusyId(medication.id);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (e) {
      setError(supplyErrorMessage(e, fallback));
    } finally {
      setBusyId(null);
    }
  }

  const markRequested = (m: HealthMedication) =>
    act(m, () => apiClient.post(`/api/health/medications/${m.id}/supply/request`, {}), "Could not mark it requested.");
  const clearRequest = (m: HealthMedication) =>
    act(m, () => apiClient.delete(`/api/health/medications/${m.id}/supply/request`), "Could not clear the request.");

  async function saveLead() {
    const days = parseDays(leadText, 90);
    if (days === null) {
      setError("Enter a whole number of days, from 0 to 90.");
      return;
    }
    setError(null);
    try {
      const res = await apiClient.put<{ defaultLeadDays: number }>(`/api/health/supply-settings/${memberId}`, { defaultLeadDays: days });
      setDefaultLead(res.defaultLeadDays);
      setEditingLead(false);
      onChanged();
    } catch (e) {
      setError(supplyErrorMessage(e, "Could not save the lead time."));
    }
  }

  return (
    <Card>
      <CardBody className={collapsed ? undefined : "space-y-4"}>
        <CollapsibleHeader
          id="health-supplies"
          title="Supplies"
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
          summary={supplySummary(medications)}
        />

        <div id="health-supplies-body" hidden={collapsed} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
            {editingLead ? (
              <>
                <span>Remind {memberLabelText} this many days before a medication runs out:</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-20"
                  value={leadText}
                  onChange={(e) => setLeadText(e.target.value)}
                  maxLength={2}
                  aria-label="Default refill lead time in days"
                  autoFocus
                />
                <Button size="sm" onClick={() => void saveLead()}>
                  Save
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditingLead(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span>
                  Refill reminders: {defaultLead} day{defaultLead === 1 ? "" : "s"} before it runs out
                </span>
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setLeadText(String(defaultLead));
                      setEditingLead(true);
                    }}
                  >
                    Change
                  </Button>
                ) : null}
              </>
            )}
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}

          {medications.length > 0 && !hasAnyEstimate ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Supply tracking tells you when to ask for a refill. You enter how many days of pills you have and it works out the run-out date. It is
              an estimate you confirm, not a live count: logging a dose never changes it.
            </p>
          ) : null}

          {canWrite && !dismissed && needingSetup.length > 0 ? (
            <Alert variant="info">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {needingSetup.length === 1 ? "1 medication has" : `${needingSetup.length} medications have`} no supply estimate yet.
                </span>
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => setSetupOpen(true)}>
                    Set up supply
                  </Button>
                  <Button size="sm" variant="ghost" onClick={dismissSetup}>
                    Not now
                  </Button>
                </span>
              </div>
            </Alert>
          ) : null}

          {groups.length === 0 ? (
            <EmptyState
              title="No medications yet"
              description={`Add a medication for ${memberLabelText} and you can track how long it lasts. Supply is an estimate you confirm, not live inventory.`}
            />
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.key} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {group.pharmacy ? group.pharmacy.name : "No pharmacy"}
                    {group.pharmacy?.archived ? (
                      <span className="ml-2 normal-case">
                        <Badge>Archived</Badge>
                      </span>
                    ) : null}
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map(({ medication, supply }) => {
                      const status = supply ? supplyStatus(supply, medication.enabled) : null;
                      const mayChange = medication.canEdit !== false;
                      const busy = busyId === medication.id;
                      return (
                        <li
                          key={medication.id}
                          id={`supply-${medication.id}`}
                          className={
                            "space-y-2 rounded-lg border p-3 transition-colors " +
                            (flashId === medication.id ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]" : "border-[var(--color-border)]")
                          }
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-words font-medium text-[var(--color-text)]">
                                {medication.name}
                                {medication.dosage ? <span className="font-normal text-[var(--color-text-muted)]"> · {medication.dosage}</span> : null}
                              </p>
                              <p className="text-sm text-[var(--color-text-muted)]">
                                {supply?.runsOutOn
                                  ? [
                                      `Runs out ${formatDay(supply.runsOutOn)}`,
                                      medication.enabled ? daysLeftLabel(supply.daysRemaining) : "",
                                      medication.enabled && supply.deadline && supply.state !== "requested" && supply.state !== "not_needed"
                                        ? `Refill by ${formatDay(supply.deadline)}`
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")
                                  : "No supply estimate yet"}
                              </p>
                              {supply?.requestedAt ? (
                                <p className="text-sm text-[var(--color-text-muted)]">{requestAgeLabel(supply.requestedAt)}</p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              {supply?.needsConfirmation ? <Badge tone="warning">Confirm estimate</Badge> : null}
                              {onEditMedication && medication.canEdit !== false ? (
                                <Button type="button" size="sm" variant="ghost" onClick={() => onEditMedication(medication.id)}>
                                  Edit medication
                                </Button>
                              ) : null}
                              {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                            </div>
                          </div>

                          {mayChange ? (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSheet({ mode: "set", medication })}>
                                {supply?.runsOutOn ? "Update supply" : "Set supply"}
                              </Button>
                              {supply?.needsConfirmation && medication.enabled ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setConfirmError(null);
                                    setConfirming(medication);
                                  }}
                                >
                                  Confirm estimate
                                </Button>
                              ) : null}
                              {canMarkRequested(supply ?? undefined, medication.enabled) ? (
                                <Button size="sm" variant="secondary" loading={busy} onClick={() => void markRequested(medication)}>
                                  Mark requested
                                </Button>
                              ) : null}
                              {medication.enabled ? (
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSheet({ mode: "receive", medication })}>
                                  Mark received
                                </Button>
                              ) : null}
                              {supply?.state === "requested" || supply?.requestedAt ? (
                                <Button size="sm" variant="secondary" loading={busy} onClick={() => void clearRequest(medication)}>
                                  Clear request
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </CardBody>

      <SupplySetupSheet
        open={setupOpen}
        memberLabelText={memberLabelText}
        medications={medications}
        onClose={() => setSetupOpen(false)}
        onSaved={onChanged}
      />

      <SupplyConfirmDialog
        medication={confirming}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void confirmCurrent()}
        onReplace={() => {
          const med = confirming;
          setConfirming(null);
          if (med) setSheet({ mode: "set", medication: med });
        }}
        onLater={() => setConfirming(null)}
      />

      <SupplySheet
        open={sheet !== null}
        mode={sheet?.mode ?? "set"}
        medication={sheet?.medication ?? null}
        defaultLeadDays={defaultLead}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null);
          onChanged();
        }}
      />
    </Card>
  );
}
