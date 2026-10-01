"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { HealthAclGrants } from "./HealthPeopleAccessPanel";
import type { NoteShareMember } from "./NoteSharePicker";
import { Alert, Badge, Button, Card, CardBody, Checkbox, Input, LocalDateTime, SectionHeader } from "./ui";

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

interface MyAllyFileStatus {
  enabled: boolean;
  links: MyAllyFileLink[];
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

function MemberLink({
  member,
  link,
  busy,
  onAction,
}: {
  member: NoteShareMember;
  link: MyAllyFileLink | null;
  busy: boolean;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const base = `/api/health/myallyfile/links/${member.memberId}`;

  return (
    <li className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{member.label}</p>
        {link ? statusBadge(link) : <Badge>Not linked</Badge>}
      </div>

      {!link ? (
        <div className="space-y-2">
          <p className="text-sm">
            In MyAllyFile, open the profile, choose <strong>Connected apps</strong>, then{" "}
            <strong>Connect Domi Ops</strong>, and paste the code here.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`MyAllyFile link code for ${member.label}`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="AB3D-7XYZ"
              autoComplete="off"
              maxLength={12}
            />
            <Button
              disabled={busy || code.trim().length === 0}
              onClick={() =>
                onAction(async () => {
                  await apiClient.post("/api/health/myallyfile/links", { memberId: member.memberId, code });
                  setCode("");
                })
              }
            >
              Link profile
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
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

          <div className="space-y-1">
            <p className="text-sm font-medium">Also include</p>
            <Checkbox
              id={`mya-prn-${member.memberId}`}
              label="As-needed (PRN) medications"
              checked={link.includePrn}
              disabled={busy}
              onChange={(e) => onAction(() => apiClient.patch(base, { includePrn: e.target.checked }))}
            />
            <Checkbox
              id={`mya-otc-${member.memberId}`}
              label="Over-the-counter medications"
              checked={link.includeOtc}
              disabled={busy}
              onChange={(e) => onAction(() => apiClient.patch(base, { includeOtc: e.target.checked }))}
            />
            <Checkbox
              id={`mya-paused-${member.memberId}`}
              label="Paused medications (shown as paused)"
              checked={link.includePaused}
              disabled={busy}
              onChange={(e) => onAction(() => apiClient.patch(base, { includePaused: e.target.checked }))}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {link.status !== "revoked" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onAction(() => apiClient.post(`${base}/sync`))}
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
                    onAction(async () => {
                      await apiClient.delete(base);
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
        </div>
      )}
    </li>
  );
}

/**
 * Settings card for the one-way medication sync to MyAllyFile emergency profiles (ADR 006).
 * Lists each person the viewer can manage medications for. Renders nothing when the integration
 * isn't available on this deployment or the health module is off.
 */
export function MyAllyFileSettings() {
  const [status, setStatus] = useState<MyAllyFileStatus | null>(null);
  const [members, setMembers] = useState<NoteShareMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, roster, caps] = await Promise.all([
        apiClient.get<MyAllyFileStatus>("/api/health/myallyfile"),
        apiClient.get<{ members: NoteShareMember[] }>("/api/core/household/roster"),
        apiClient.get<{ bySubject: Record<string, HealthAclGrants> }>("/api/health/capabilities"),
      ]);
      setStatus(st);
      const writable = roster.members.filter((m) => caps.bySubject?.[m.memberId]?.medications === "write");
      setMembers(writable);
    } catch {
      // Optional card: if the health module is off or the status can't load, just hide it.
      setStatus({ enabled: false, links: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The push happens in the worker, so while one is pending re-read the status until it settles.
  const pending = status?.links.some((l) => l.syncPending) ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [pending, status, load]);

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

  if (!status?.enabled || members.length === 0) return null;

  return (
    <Card>
      <CardBody className="space-y-4">
        <SectionHeader title="MyAllyFile emergency profiles" />
        <p className="text-sm text-[var(--color-text-muted)]">
          Keep a person&apos;s{" "}
          <a className="underline" href={MYALLYFILE_URL} target="_blank" rel="noreferrer">
            MyAllyFile
          </a>{" "}
          emergency profile current. Once linked, all of their medications are copied there automatically
          whenever they change. It only goes one way: nothing is read back from MyAllyFile. Anyone with the
          profile&apos;s emergency PIN can see the synced medications. Linking needs a MyAllyFile Plus or Pro plan.
        </p>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <ul className="space-y-3">
          {members.map((m) => (
            <MemberLink
              key={m.memberId}
              member={m}
              link={status.links.find((l) => l.memberId === m.memberId) ?? null}
              busy={busy}
              onAction={run}
            />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
