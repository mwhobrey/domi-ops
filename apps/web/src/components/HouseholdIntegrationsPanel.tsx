"use client";

import { Calendar, Cloud, KeyRound, Radio } from "lucide-react";
import { Card, CardBody, LinkButton, SectionHeader } from "./ui";

export type HouseholdIntegrationsStatus = {
  googleLogin: { configured: boolean };
  calendarSync: {
    moduleEnabled: boolean;
    oauthConfigured: boolean;
    defaultSyncMode: string;
    householdConnections: number;
    activeSyncRuns: number;
    lastSyncAt: string | null;
  };
  webPush: { configured: boolean };
  storage: { configured: boolean; bucket: string | null };
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? "rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-success)]"
          : "rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]"
      }
    >
      {label}
    </span>
  );
}

function IntegrationRow({
  icon,
  title,
  status,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  status: React.ReactNode;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 border-b border-[var(--color-border)] py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]"
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            {status}
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">{detail}</p>
        </div>
      </div>
      {action ? <div className="shrink-0 sm:pt-1">{action}</div> : null}
    </li>
  );
}

export function HouseholdIntegrationsPanel({ status }: { status: HouseholdIntegrationsStatus }) {
  const calendarConnected = status.calendarSync.householdConnections > 0;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="space-y-1">
          <SectionHeader title="Integrations" />
          <p className="text-sm text-[var(--color-text-muted)]">
            Read-only operator view of server and household integration health. Connect flows live on
            profile and calendar pages.
          </p>
        </div>

        <ul>
          <IntegrationRow
            icon={<KeyRound className="h-4 w-4" />}
            title="Google sign-in"
            status={
              <StatusBadge
                ok={status.googleLogin.configured}
                label={status.googleLogin.configured ? "Configured" : "Not configured"}
              />
            }
            detail="Better Auth Google OAuth for login and calendar connect."
          />

          <IntegrationRow
            icon={<Calendar className="h-4 w-4" />}
            title="Google Calendar sync"
            status={
              <StatusBadge
                ok={calendarConnected && status.calendarSync.oauthConfigured}
                label={
                  !status.calendarSync.moduleEnabled
                    ? "Module off"
                    : !status.calendarSync.oauthConfigured
                      ? "OAuth missing"
                      : calendarConnected
                        ? "Connected"
                        : "Not connected"
                }
              />
            }
            detail={
              !status.calendarSync.moduleEnabled
                ? "Calendar sync module is disabled for this household or server."
                : `Default mode: ${status.calendarSync.defaultSyncMode.replace(/_/g, " ")} · ${status.calendarSync.householdConnections} household connection${status.calendarSync.householdConnections === 1 ? "" : "s"}${
                    status.calendarSync.activeSyncRuns > 0
                      ? ` · ${status.calendarSync.activeSyncRuns} sync run${status.calendarSync.activeSyncRuns === 1 ? "" : "s"} active`
                      : ""
                  }${
                    status.calendarSync.lastSyncAt
                      ? ` · Last sync ${new Date(status.calendarSync.lastSyncAt).toLocaleString()}`
                      : ""
                  }`
            }
            action={
              status.calendarSync.moduleEnabled ? (
                <div className="flex flex-wrap gap-2">
                  <LinkButton href="/profile" variant="ghost" size="sm">
                    Profile connect
                  </LinkButton>
                  <LinkButton href="/calendar" variant="ghost" size="sm">
                    Calendar settings
                  </LinkButton>
                </div>
              ) : undefined
            }
          />

          <IntegrationRow
            icon={<Radio className="h-4 w-4" />}
            title="Web Push (VAPID)"
            status={
              <StatusBadge
                ok={status.webPush.configured}
                label={status.webPush.configured ? "Configured" : "Not configured"}
              />
            }
            detail="Required for notice, calendar, chore, and budget push alerts."
            action={
              <LinkButton href="/profile" variant="ghost" size="sm">
                Notification settings
              </LinkButton>
            }
          />

          <IntegrationRow
            icon={<Cloud className="h-4 w-4" />}
            title="File storage (S3)"
            status={
              <StatusBadge
                ok={status.storage.configured}
                label={status.storage.configured ? "Configured" : "Not configured"}
              />
            }
            detail={
              status.storage.configured
                ? `Bucket: ${status.storage.bucket ?? "domi-ops"} — avatars, school uploads, receipts.`
                : "S3/MinIO env vars missing — avatars and file uploads will fail."
            }
          />
        </ul>
      </CardBody>
    </Card>
  );
}
