"use client";

import { ClipboardCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import type { HealthAclGrants } from "../HealthPeopleAccessPanel";
import { Alert, Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, ListItem, SectionHeader } from "../ui";
import { HealthCheckSheet } from "./HealthCheckSheet";
import { checkDateRangeSummary, checkErrorMessage, checkScheduleSummary, checkTypeLabel } from "./health-check-form";
import { memberLabel } from "./health-helpers";
import type { HealthCheck } from "./health-types";

/**
 * The Checks tab (WHO-389): every scheduled check the viewer can see, grouped by person, with
 * create / edit / pause / delete for the people they may change. Logging a check happens on the
 * Today tab, not here.
 */
export function ChecksManagerClient({
  members,
  currentMemberId,
  capabilities,
  onChanged,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  capabilities: Record<string, HealthAclGrants>;
  /** Tell the page its Today list is stale. */
  onChanged?: () => void;
}) {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<HealthCheck | null>(null);
  const [deleting, setDeleting] = useState<HealthCheck | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const writableMemberIds = useMemo(
    () => members.filter((m) => capabilities[m.memberId]?.events === "write").map((m) => m.memberId),
    [members, capabilities],
  );
  const canCreate = writableMemberIds.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ checks: HealthCheck[] }>("/api/health/checks");
      setChecks(res.checks);
    } catch (e) {
      setError(e instanceof ApiError ? checkErrorMessage(e, "Failed to load checks") : "Failed to load checks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function changed() {
    void load();
    onChanged?.();
  }

  async function setEnabled(check: HealthCheck, enabled: boolean) {
    setBusyId(check.id);
    setError(null);
    try {
      await apiClient.patch(`/api/health/checks/${check.id}`, { enabled });
      changed();
    } catch (e) {
      setError(checkErrorMessage(e, enabled ? "Could not resume" : "Could not pause"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(check: HealthCheck) {
    setDeleting(null);
    setBusyId(check.id);
    setError(null);
    try {
      await apiClient.delete(`/api/health/checks/${check.id}`);
      changed();
    } catch (e) {
      setError(checkErrorMessage(e, "Could not delete"));
    } finally {
      setBusyId(null);
    }
  }

  const byMember = useMemo(() => {
    const map = new Map<string, HealthCheck[]>();
    for (const check of checks) {
      const list = map.get(check.memberId) ?? [];
      list.push(check);
      map.set(check.memberId, list);
    }
    // The viewer first, then everyone else in roster order.
    const order = [currentMemberId, ...members.map((m) => m.memberId)];
    return [...map.entries()].sort(
      ([a], [b]) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b),
    );
  }, [checks, members, currentMemberId]);

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-muted)]">
          Regular readings and entries, like blood pressure four times a day. They show on the Today tab
          and send reminders.
        </p>
        {canCreate ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
          >
            New check
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : checks.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" aria-hidden />}
          title="No checks yet"
          description={
            canCreate
              ? "Set one up to be reminded to log vitals, meals, pain or exercise on a schedule."
              : "Nobody has set up a check you can see."
          }
        />
      ) : (
        byMember.map(([memberId, list]) => (
          <Card key={memberId} className="overflow-hidden">
            <CardBody className="space-y-3">
              <SectionHeader
                title={memberId === currentMemberId ? "My checks" : `${memberLabel(members, memberId)}'s checks`}
              />
              <ul className="space-y-2">
                {list.map((check) => {
                  const range = checkDateRangeSummary(check);
                  const busy = busyId === check.id;
                  return (
                    <ListItem key={check.id} as="div">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 text-left">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-text)]">
                            <span className="truncate">{check.name}</span>
                            {check.enabled ? null : <Badge tone="warning">Paused</Badge>}
                            {check.visibility === "private" ? <Badge tone="default">Private</Badge> : null}
                          </p>
                          <p className="text-sm text-[var(--color-text-muted)]">
                            {[checkTypeLabel(check.eventType), checkScheduleSummary(check), range]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {check.canEdit ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setEditing(check);
                                setSheetOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void setEnabled(check, !check.enabled)}
                            >
                              {check.enabled ? "Pause" : "Resume"}
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDeleting(check)}>
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </ListItem>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        ))
      )}

      <HealthCheckSheet
        open={sheetOpen}
        check={editing}
        members={members}
        currentMemberId={currentMemberId}
        writableMemberIds={writableMemberIds}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setSheetOpen(false);
          setEditing(null);
          changed();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this check?"
        message={
          deleting
            ? `"${deleting.name}" stops reminding and disappears from the Today tab. Entries already logged are kept.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
