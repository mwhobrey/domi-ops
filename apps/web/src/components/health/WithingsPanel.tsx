"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { HealthAclGrants } from "../HealthPeopleAccessPanel";
import type { NoteShareMember } from "../NoteSharePicker";
import { Alert, Badge, Button, Card, CardBody, ConfirmDialog, LocalDateTime, SectionHeader, Select } from "../ui";
import {
  WITHINGS_DEFAULT_HISTORY_DAYS,
  WITHINGS_HISTORY_OPTIONS,
  withingsActionError,
  withingsLinkState,
  type WithingsLink,
  type WithingsNotice,
  type WithingsStatus,
} from "./withings-helpers";

/** How often to re-read a link that is still importing or waiting on a pull (the worker does the work). */
const SETTLE_POLL_MS = 8000;

/** "Oct 13, 2025" in the viewer's zone. The default format shows a time of day, which is noise here. */
const formatStartDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function HistorySelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (days: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="min-w-[12rem]">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {WITHINGS_HISTORY_OPTIONS.map((o) => (
          <option key={o.days} value={o.days}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function PersonRow({
  member,
  link,
  busy,
  onAction,
}: {
  member: NoteShareMember;
  link: WithingsLink | null;
  busy: boolean;
  onAction: (action: () => Promise<unknown>, opts?: { keepBusy?: boolean }) => Promise<void>;
}) {
  const [days, setDays] = useState<number>(WITHINGS_DEFAULT_HISTORY_DAYS);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const base = `/api/health/withings/links/${member.memberId}`;
  const state = withingsLinkState(link);

  return (
    <li className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{member.label}</p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>

      {!link ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            You&apos;ll sign in to Withings and approve access to blood pressure readings. Pick how far back to
            import.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <HistorySelect
              id={`withings-history-${member.memberId}`}
              label={`How much of ${member.label}'s history to import`}
              value={days}
              onChange={setDays}
              disabled={busy}
            />
            <Button
              disabled={busy}
              onClick={() =>
                onAction(
                  async () => {
                    const { authorizeUrl } = await apiClient.post<{ authorizeUrl: string }>(`${base}/connect`, {
                      backfillDays: days,
                    });
                    window.location.assign(authorizeUrl);
                  },
                  // Leaving the page: keep the button disabled so a second click can't start a second sign-in.
                  { keepBusy: true },
                )
              }
            >
              Connect Withings
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            {link.lastSyncedAt ? (
              <>
                Last synced <LocalDateTime value={link.lastSyncedAt} />.
              </>
            ) : (
              "Not synced yet."
            )}{" "}
            Importing readings from <LocalDateTime value={link.backfillFrom} format={formatStartDate} /> onward.
          </p>

          {link.status === "revoked" ? (
            <Alert variant="info">
              Withings access was withdrawn (or has lapsed), so nothing more will import. Unlink, then connect again.
              Readings already imported stay.
            </Alert>
          ) : null}
          {link.status === "error" ? (
            <Alert variant="error">
              Syncing with Withings failed several times in a row{link.lastError ? ` (${link.lastError})` : ""}. Choose
              Sync now to try again.
            </Alert>
          ) : null}
          {link.status === "active" && link.lastError ? (
            <Alert variant="error">
              The last sync failed ({link.lastError}). It will retry on its own.
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {link.status !== "revoked" ? (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction(() => apiClient.post(`${base}/sync`))}>
                  Sync now
                </Button>
                <HistorySelect
                  id={`withings-rehistory-${member.memberId}`}
                  label={`Import more of ${member.label}'s history`}
                  value={days}
                  onChange={setDays}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onAction(() => apiClient.post(`${base}/backfill`, { days }))}
                >
                  Import history
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmUnlink(true)}>
              Unlink
            </Button>
          </div>

          <ConfirmDialog
            open={confirmUnlink}
            title={`Unlink ${member.label}'s Withings account?`}
            message="New readings will stop importing. Readings already in Domi Ops stay, and so does the data at Withings."
            confirmLabel="Unlink"
            loading={busy}
            onCancel={() => setConfirmUnlink(false)}
            onConfirm={() =>
              onAction(async () => {
                await apiClient.delete(base);
                setConfirmUnlink(false);
              })
            }
          />
        </div>
      )}
    </li>
  );
}

/**
 * Connect a Withings blood pressure cuff to a person (WHO-453). Readings arrive on their own once
 * linked and fill that person's scheduled blood pressure checks, so this lives with the checks.
 * Lists each person the viewer can log health entries for. Renders nothing when Withings isn't set
 * up on this server, or the viewer can't manage anyone's entries.
 *
 * `notice` is how the Withings round trip went (`/health?withings=...`). The parent owns it, not
 * this component: the Health page reloads its data and a tab switch remounts this, either of which
 * would otherwise throw the message away before anyone read it.
 */
export function WithingsPanel({
  members,
  capabilities,
  notice,
  onDismissNotice,
}: {
  members: NoteShareMember[];
  capabilities: Record<string, HealthAclGrants>;
  notice: WithingsNotice | null;
  onDismissNotice: () => void;
}) {
  const [status, setStatus] = useState<WithingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await apiClient.get<WithingsStatus>("/api/health/withings"));
    } catch {
      // Optional panel: if the health module is off or the status can't load at first, hide it. A
      // failed re-read later (the API restarting, one dropped request) keeps what is already shown, so
      // the controls don't vanish and the polling doesn't stop.
      setStatus((prev) => prev ?? { enabled: false, links: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Connect leaves the buttons disabled while the browser heads to Withings. Coming back with Back can
  // restore this page from the browser's cache exactly as it was, so release them.
  useEffect(() => {
    const release = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", release);
    return () => window.removeEventListener("pageshow", release);
  }, []);

  const settling = status?.links.some((l) => withingsLinkState(l).settling) ?? false;
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => void load(), SETTLE_POLL_MS);
    return () => clearTimeout(timer);
  }, [settling, status, load]);

  async function run(action: () => Promise<unknown>, opts: { keepBusy?: boolean } = {}) {
    setBusy(true);
    setError(null);
    onDismissNotice();
    let leaving = false;
    try {
      await action();
      leaving = opts.keepBusy === true;
      if (!leaving) await load();
    } catch (err) {
      setError(withingsActionError(err instanceof ApiError ? err.status : null));
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  const writable = members.filter((m) => capabilities[m.memberId]?.events === "write");
  const noticeAlert = notice ? (
    <Alert variant={notice.variant}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span>{notice.message}</span>
        <button type="button" className="shrink-0 text-xs underline" onClick={onDismissNotice}>
          Dismiss
        </button>
      </div>
    </Alert>
  ) : null;

  if (!status) return null;
  if (!status.enabled || writable.length === 0) return noticeAlert;

  return (
    <Card>
      <CardBody className="space-y-4">
        <SectionHeader title="Blood pressure cuff (Withings)" />
        <p className="text-sm text-[var(--color-text-muted)]">
          Connect a Withings cuff and readings arrive on their own, no typing, and fill scheduled blood pressure checks
          that fall near them. Only blood pressure and pulse are imported, and only into Domi Ops: nothing is sent back
          to Withings.
        </p>
        <p className="text-sm text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">Withings+ for new accounts.</strong> Since October 12, 2026,
          Withings requires a Withings+ membership before a Withings account created after that date can share data
          with apps like Domi Ops. Accounts created earlier are not affected. Withings+ is Withings&apos; own paid
          membership; Domi Ops doesn&apos;t sell it or pay for it.
        </p>
        {noticeAlert}
        {error ? <Alert variant="error">{error}</Alert> : null}
        <ul className="space-y-3">
          {writable.map((m) => (
            <PersonRow
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
