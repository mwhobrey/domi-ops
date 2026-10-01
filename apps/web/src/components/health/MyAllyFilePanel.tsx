"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { HealthMedication } from "./health-types";
import { scheduleKindLabel } from "./health-helpers";
import { Alert, Badge, Button, Card, CardBody, Checkbox, Input, LocalDateTime, SectionHeader } from "../ui";

type LinkStatus = "active" | "entitlement_required" | "revoked" | "error";

interface MyAllyFileLink {
  memberId: string;
  status: LinkStatus;
  profileName: string | null;
  includePrn: boolean;
  includeOtc: boolean;
  includePaused: boolean;
  linkedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncPending: boolean;
}

interface MyAllyFileState {
  enabled: boolean;
  links: MyAllyFileLink[];
  syncedMedicationIds: string[];
}

const MYALLYFILE_URL = "https://myallyfile.com";

function linkErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return "That MyAllyFile account needs a Plus or Pro plan to connect. Upgrade at myallyfile.com/pricing, then make a new code.";
    if (err.status === 404) return "That MyAllyFile profile no longer exists. Pick another profile and make a new code.";
    if (err.status === 422) return "That code didn't work. It may have expired (they last 10 minutes) or been used already. Make a new one in MyAllyFile.";
    if (err.status === 400) return "Enter the 8-character code from MyAllyFile (like AB3D-7XYZ).";
    if (err.status === 409) return "This person is already linked to a MyAllyFile profile.";
    if (err.status === 502) return "Couldn't reach MyAllyFile. Try again in a minute.";
    if (err.status === 403) return "You need permission to manage this person's medications.";
  }
  return "Something went wrong. Try again.";
}

function statusBadge(link: MyAllyFileLink) {
  switch (link.status) {
    case "active":
      return <Badge tone="success">{link.syncPending ? "Syncing…" : "Connected"}</Badge>;
    case "entitlement_required":
      return <Badge tone="warning">Upgrade needed</Badge>;
    case "revoked":
      return <Badge tone="warning">Disconnected</Badge>;
    default:
      return <Badge tone="warning">Needs attention</Badge>;
  }
}

/**
 * One-way sync of a member's medications to a MyAllyFile emergency profile (ADR 006).
 * Renders nothing when the integration isn't available (self-hosted without MYALLYFILE_API_BASE).
 */
export function MyAllyFilePanel({
  memberId,
  memberName,
  medications,
  canWrite,
}: {
  memberId: string;
  memberName: string;
  medications: HealthMedication[];
  canWrite: boolean;
}) {
  const [state, setState] = useState<MyAllyFileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await apiClient.get<MyAllyFileState>("/api/health/myallyfile"));
    } catch {
      // The panel is optional; a failed status read just hides it.
      setState({ enabled: false, links: [], syncedMedicationIds: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The push happens in the worker, so while one is pending re-read the status until it settles.
  const pending = state?.links.some((l) => l.memberId === memberId && l.syncPending) ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [pending, state, load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(linkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state?.enabled) return null;
  const link = state.links.find((l) => l.memberId === memberId) ?? null;
  const synced = new Set(state.syncedMedicationIds);
  const syncable = medications.filter((m) => m.memberId === memberId);

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title="MyAllyFile emergency profile" />
          {link ? statusBadge(link) : null}
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}

        {!link ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Keep {memberName}&apos;s emergency profile current. Medications you choose here are copied to{" "}
              <a className="underline" href={MYALLYFILE_URL} target="_blank" rel="noreferrer">
                MyAllyFile
              </a>{" "}
              automatically whenever they change. It only goes one way: nothing is read back from MyAllyFile.
              Linking needs a MyAllyFile Plus or Pro plan.
            </p>
            {canWrite ? (
              <div className="space-y-2">
                <p className="text-sm">
                  In MyAllyFile, open the profile, choose <strong>Connected apps</strong>, then{" "}
                  <strong>Connect Domi Ops</strong>, and paste the code here.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    aria-label="MyAllyFile link code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="AB3D-7XYZ"
                    autoComplete="off"
                    maxLength={12}
                  />
                  <Button
                    disabled={busy || code.trim().length === 0}
                    onClick={() =>
                      run(async () => {
                        await apiClient.post("/api/health/myallyfile/links", { memberId, code });
                        setCode("");
                      })
                    }
                  >
                    Link profile
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                You don&apos;t have permission to link this person&apos;s profile.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              Linked to <strong>{link.profileName ?? "a MyAllyFile profile"}</strong>.{" "}
              {link.lastSyncedAt ? (
                <>
                  Last synced <LocalDateTime value={link.lastSyncedAt} />.
                </>
              ) : (
                "Not synced yet."
              )}
            </p>

            {link.status === "entitlement_required" ? (
              <Alert variant="info">
                The MyAllyFile account needs a Plus or Pro plan to sync medications.{" "}
                <a className="underline" href={`${MYALLYFILE_URL}/pricing`} target="_blank" rel="noreferrer">
                  See plans
                </a>
                , then choose Sync now.
              </Alert>
            ) : null}
            {link.status === "revoked" ? (
              <Alert variant="info">
                This link was removed on the MyAllyFile side. Unlink here, then connect again with a new code.
              </Alert>
            ) : null}
            {link.status === "error" ? (
              <Alert variant="error">
                MyAllyFile couldn&apos;t find that profile (it may have been deleted). Unlink, then connect again.
              </Alert>
            ) : null}
            {link.status === "active" && link.lastError ? (
              <Alert variant="error">The last sync failed ({link.lastError}). We&apos;ll retry on the next change.</Alert>
            ) : null}

            <div className="space-y-2">
              <p className="text-sm font-medium">Medications to include</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Anyone with the emergency PIN can see these on the MyAllyFile profile. Nothing is shared until you
                tick it.
              </p>
              {syncable.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No medications yet.</p>
              ) : (
                <ul className="space-y-1">
                  {syncable.map((med) => (
                    <li key={med.id} className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id={`mya-med-${med.id}`}
                        label={
                          <>
                            {med.name}
                            {med.dosage ? ` ${med.dosage}` : ""}
                            <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                              {scheduleKindLabel(med.scheduleKind)}
                              {med.enabled ? "" : " · paused"}
                            </span>
                          </>
                        }
                        checked={synced.has(med.id)}
                        disabled={busy || !canWrite}
                        onChange={(e) =>
                          run(() =>
                            apiClient.put(`/api/health/myallyfile/medications/${med.id}`, { sync: e.target.checked }),
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Also include</p>
              <Checkbox
                id="mya-prn"
                label="As-needed (PRN) medications that are ticked above"
                checked={link.includePrn}
                disabled={busy || !canWrite}
                onChange={(e) =>
                  run(() => apiClient.patch(`/api/health/myallyfile/links/${memberId}`, { includePrn: e.target.checked }))
                }
              />
              <Checkbox
                id="mya-otc"
                label="Over-the-counter medications that are ticked above"
                checked={link.includeOtc}
                disabled={busy || !canWrite}
                onChange={(e) =>
                  run(() => apiClient.patch(`/api/health/myallyfile/links/${memberId}`, { includeOtc: e.target.checked }))
                }
              />
              <Checkbox
                id="mya-paused"
                label="Paused medications (shown as paused)"
                checked={link.includePaused}
                disabled={busy || !canWrite}
                onChange={(e) =>
                  run(() =>
                    apiClient.patch(`/api/health/myallyfile/links/${memberId}`, { includePaused: e.target.checked }),
                  )
                }
              />
            </div>

            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                {link.status !== "revoked" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => apiClient.post(`/api/health/myallyfile/links/${memberId}/sync`))}
                  >
                    Sync now
                  </Button>
                ) : null}
                {confirmUnlink ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await apiClient.delete(`/api/health/myallyfile/links/${memberId}`);
                          setConfirmUnlink(false);
                        })
                      }
                    >
                      Unlink and remove from MyAllyFile
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirmUnlink(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmUnlink(true)}>
                    Unlink
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
