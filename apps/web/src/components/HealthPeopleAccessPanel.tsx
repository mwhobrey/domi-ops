"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteShareMember } from "./NoteSharePicker";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Select } from "./ui";

export type HealthAclLevel = "none" | "read" | "write";

export type HealthAclGrants = {
  events: HealthAclLevel;
  medications: HealthAclLevel;
  doses: HealthAclLevel;
  reports: HealthAclLevel;
};

const LEVELS: { value: HealthAclLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
];

const SEGMENTS: { key: keyof HealthAclGrants; label: string }[] = [
  { key: "events", label: "Events" },
  { key: "medications", label: "Medications" },
  { key: "doses", label: "Dose logs" },
  { key: "reports", label: "Reports" },
];

export function emptyHealthAclGrants(): HealthAclGrants {
  return { events: "none", medications: "none", doses: "none", reports: "none" };
}

const PRESET_VIEWER: HealthAclGrants = {
  events: "read",
  medications: "read",
  doses: "read",
  reports: "read",
};

const PRESET_CAREGIVER: HealthAclGrants = {
  events: "write",
  medications: "write",
  doses: "write",
  reports: "read",
};

const PRESET_DOSE_HELPER: HealthAclGrants = {
  events: "none",
  medications: "none",
  doses: "write",
  reports: "none",
};

function grantsEqual(a: HealthAclGrants, b: HealthAclGrants): boolean {
  return (
    a.events === b.events &&
    a.medications === b.medications &&
    a.doses === b.doses &&
    a.reports === b.reports
  );
}

function summarizeGrants(g: HealthAclGrants): {
  label: "Caregiver" | "Viewer" | "Dose helper" | "Custom" | "No access";
  tone: "accent" | "default" | "warning";
} {
  if (grantsEqual(g, emptyHealthAclGrants())) return { label: "No access", tone: "default" };
  if (grantsEqual(g, PRESET_CAREGIVER)) return { label: "Caregiver", tone: "accent" };
  if (grantsEqual(g, PRESET_VIEWER)) return { label: "Viewer", tone: "default" };
  if (grantsEqual(g, PRESET_DOSE_HELPER)) return { label: "Dose helper", tone: "warning" };
  return { label: "Custom", tone: "warning" };
}

function serializeMap(map: Record<string, HealthAclGrants>, granteeIds: string[]): string {
  return JSON.stringify(
    granteeIds.map((id) => {
      const g = map[id] ?? emptyHealthAclGrants();
      return { id, ...g };
    }),
  );
}

export function HealthPeopleAccessPanel({
  members,
  currentMemberId,
  householdRole,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  householdRole: string;
}) {
  const isAdmin = householdRole === "owner" || householdRole === "admin";
  const manageOptions = useMemo(() => {
    if (isAdmin) return members;
    return members.filter((m) => m.memberId === currentMemberId);
  }, [isAdmin, members, currentMemberId]);

  const [subjectMemberId, setSubjectMemberId] = useState(
    manageOptions.some((m) => m.memberId === currentMemberId)
      ? currentMemberId
      : (manageOptions[0]?.memberId ?? currentMemberId),
  );
  const [byGrantee, setByGrantee] = useState<Record<string, HealthAclGrants>>({});
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const grantees = members.filter((m) => m.memberId !== subjectMemberId);
  const dirty =
    savedSnapshot !== "" && serializeMap(byGrantee, grantees.map((m) => m.memberId)) !== savedSnapshot;

  const load = useCallback(async (subjectId: string) => {
    setLoading(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await apiClient.get<{
        grants: Array<{ granteeMemberId: string } & HealthAclGrants>;
      }>(`/api/health/acl/${subjectId}`);
      const map: Record<string, HealthAclGrants> = {};
      for (const g of res.grants ?? []) {
        map[g.granteeMemberId] = {
          events: g.events,
          medications: g.medications,
          doses: g.doses,
          reports: g.reports,
        };
      }
      setByGrantee(map);
      const ids = members.filter((m) => m.memberId !== subjectId).map((m) => m.memberId);
      setSavedSnapshot(serializeMap(map, ids));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load sharing");
    } finally {
      setLoading(false);
    }
  }, [members]);

  useEffect(() => {
    if (!subjectMemberId) return;
    void load(subjectMemberId);
  }, [subjectMemberId, load]);

  function setLevel(granteeId: string, segment: keyof HealthAclGrants, level: HealthAclLevel) {
    setSavedMsg(null);
    setByGrantee((prev) => {
      const current = prev[granteeId] ?? emptyHealthAclGrants();
      return { ...prev, [granteeId]: { ...current, [segment]: level } };
    });
  }

  function applyPreset(granteeId: string, preset: HealthAclGrants) {
    setSavedMsg(null);
    setByGrantee((prev) => ({ ...prev, [granteeId]: { ...preset } }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const grants = grantees.map((m) => {
        const g = byGrantee[m.memberId] ?? emptyHealthAclGrants();
        return { granteeMemberId: m.memberId, ...g };
      });
      await apiClient.put(`/api/health/acl/${subjectMemberId}`, { grants });
      setSavedSnapshot(serializeMap(byGrantee, grantees.map((m) => m.memberId)));
      setSavedMsg("Saved");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save sharing");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <p className="text-sm text-[var(--color-text-muted)]">
        Grant ongoing access to this person&apos;s health. Dose write also lets them read medications
        needed to log.
      </p>
      {manageOptions.length > 1 ? (
        <label className="block max-w-sm space-y-1">
          <span className="text-sm font-medium text-[var(--color-text)]">Whose health</span>
          <Select
            value={subjectMemberId}
            onChange={(e) => setSubjectMemberId(e.target.value)}
            aria-label="Whose health to share"
          >
            {manageOptions.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label}
                {m.memberId === currentMemberId ? " (you)" : ""}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {err ? <Alert variant="error">{err}</Alert> : null}
      {savedMsg && !dirty ? <Alert variant="success">{savedMsg}</Alert> : null}
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : grantees.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No other household members.</p>
      ) : (
        <ul className="space-y-3">
          {grantees.map((m) => {
            const g = byGrantee[m.memberId] ?? emptyHealthAclGrants();
            const summary = summarizeGrants(g);
            return (
              <li key={m.memberId}>
                <Card>
                  <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--color-text)]">{m.label}</p>
                      <Badge tone={summary.tone}>{summary.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyPreset(m.memberId, PRESET_VIEWER)}
                      >
                        Viewer
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyPreset(m.memberId, PRESET_CAREGIVER)}
                      >
                        Caregiver
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => applyPreset(m.memberId, PRESET_DOSE_HELPER)}
                      >
                        Dose helper
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => applyPreset(m.memberId, emptyHealthAclGrants())}
                      >
                        Clear
                      </Button>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {SEGMENTS.map((seg) => (
                        <label key={seg.key} className="block space-y-1">
                          <span className="text-xs font-medium text-[var(--color-text-muted)]">
                            {seg.label}
                          </span>
                          <Select
                            value={g[seg.key]}
                            onChange={(e) =>
                              setLevel(m.memberId, seg.key, e.target.value as HealthAclLevel)
                            }
                            aria-label={`${m.label} ${seg.label} access`}
                          >
                            {LEVELS.map((l) => (
                              <option key={l.value} value={l.value}>
                                {l.label}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-2">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy || !dirty || grantees.length === 0 || loading}
          >
            {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>
    </div>
  );
}
