"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteShareMember } from "./NoteSharePicker";
import { Alert, Button, Select, Sheet } from "./ui";

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

function emptyGrants(): HealthAclGrants {
  return { events: "none", medications: "none", doses: "none", reports: "none" };
}

export function HealthAclSheet({
  open,
  onClose,
  members,
  currentMemberId,
  canManageSubjects,
}: {
  open: boolean;
  onClose: () => void;
  members: NoteShareMember[];
  currentMemberId: string;
  /** Subjects the current user may edit ACL for (self + admin → all). */
  canManageSubjects: string[];
}) {
  const [subjectMemberId, setSubjectMemberId] = useState(
    canManageSubjects.includes(currentMemberId)
      ? currentMemberId
      : (canManageSubjects[0] ?? currentMemberId),
  );
  const [byGrantee, setByGrantee] = useState<Record<string, HealthAclGrants>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const grantees = members.filter((m) => m.memberId !== subjectMemberId);

  useEffect(() => {
    if (!open) return;
    const nextSubject = canManageSubjects.includes(currentMemberId)
      ? currentMemberId
      : (canManageSubjects[0] ?? currentMemberId);
    setSubjectMemberId(nextSubject);
  }, [open, currentMemberId, canManageSubjects]);

  useEffect(() => {
    if (!open || !subjectMemberId) return;
    let cancelled = false;
    setErr(null);
    void (async () => {
      try {
        const res = await apiClient.get<{
          grants: Array<{ granteeMemberId: string } & HealthAclGrants>;
        }>(`/api/health/acl/${subjectMemberId}`);
        if (cancelled) return;
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
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof ApiError ? e.message : "Could not load sharing");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, subjectMemberId]);

  function setLevel(granteeId: string, segment: keyof HealthAclGrants, level: HealthAclLevel) {
    setByGrantee((prev) => {
      const current = prev[granteeId] ?? emptyGrants();
      return { ...prev, [granteeId]: { ...current, [segment]: level } };
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const grants = grantees.map((m) => {
        const g = byGrantee[m.memberId] ?? emptyGrants();
        return { granteeMemberId: m.memberId, ...g };
      });
      await apiClient.put(`/api/health/acl/${subjectMemberId}`, { grants });
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save sharing");
    } finally {
      setBusy(false);
    }
  }

  const manageOptions = members.filter((m) => canManageSubjects.includes(m.memberId));

  return (
    <Sheet open={open} onClose={onClose} title="Health sharing">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text-muted)]">
          Set access per person for events, medications, dose logging, and reports. Dose write also
          allows reading medications needed to log.
        </p>
        {manageOptions.length > 1 ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-[var(--color-text)]">Whose health</span>
            <Select
              value={subjectMemberId}
              onChange={(e) => setSubjectMemberId(e.target.value)}
            >
              {manageOptions.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {err ? <Alert variant="error">{err}</Alert> : null}
        {grantees.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No other household members.</p>
        ) : (
          <ul className="space-y-4">
            {grantees.map((m) => {
              const g = byGrantee[m.memberId] ?? emptyGrants();
              return (
                <li
                  key={m.memberId}
                  className="space-y-2 border-b border-[var(--color-border)] pb-4 last:border-0"
                >
                  <p className="font-medium text-[var(--color-text)]">{m.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SEGMENTS.map((seg) => (
                      <label key={seg.key} className="block space-y-1">
                        <span className="text-xs text-[var(--color-text-muted)]">{seg.label}</span>
                        <Select
                          value={g[seg.key]}
                          onChange={(e) =>
                            setLevel(m.memberId, seg.key, e.target.value as HealthAclLevel)
                          }
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
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || grantees.length === 0}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
