"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { HomePresence } from "../lib/home-status";
import { CalendarReminderPushSettings } from "./CalendarReminderPushSettings";
import { ChoreReminderPushSettings } from "./ChoreReminderPushSettings";
import { ExpenseBudgetPushSettings } from "./ExpenseBudgetPushSettings";
import { NoticePushSettings } from "./NoticePushSettings";
import { ProfileCalendarConnect } from "./ProfileCalendarConnect";
import { Alert, Avatar, Button, Card, CardBody, Input, LinkButton, RadioGroup, SectionHeader } from "./ui";

type TemperatureUnit = "fahrenheit" | "celsius";

function avatarErrorMessage(body: string | undefined): string {
  if (!body) return "Upload failed";
  try {
    const j = JSON.parse(body) as { error?: string };
    if (j.error === "s3_not_configured") {
      return "Photo storage is not configured on this server (S3/MinIO).";
    }
    if (j.error === "file_too_large") return "Image must be 2 MB or smaller.";
    if (j.error === "invalid_image_type") return "Use JPEG, PNG, or WebP.";
  } catch {
    /* */
  }
  return "Upload failed";
}

function ProfileSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardBody className="space-y-4">
        <div className="space-y-1">
          <SectionHeader title={title} />
          {description ? (
            <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</p>
          ) : null}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

export function ProfileEditor({
  initial,
  canManageHousehold = false,
  calendarIntegration,
}: {
  initial: {
    email: string | null;
    username?: string | null;
    memberId: string;
    name: string | null;
    shownLabel: string;
    homeStatusId: string | null;
    presence: HomePresence;
    statusMessage: string | null;
    temperatureUnit: TemperatureUnit;
    pushNoticesEnabled: boolean;
    pushCalendarRemindersEnabled: boolean;
    pushChoresRemindersEnabled: boolean;
    pushExpenseBudgetAlertsEnabled: boolean;
    pushSubscribed: boolean;
    pushAvailable: boolean;
    avatarUrl: string | null;
  };
  canManageHousehold?: boolean;
  calendarIntegration?: {
    oauthConfigured: boolean;
    defaultSyncMode: string;
    connections: { id: string; lastSyncAt: string | null }[];
  };
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [presence, setPresence] = useState<HomePresence>(initial.presence);
  const [statusMessage, setStatusMessage] = useState(initial.statusMessage ?? "");
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(initial.temperatureUnit);
  const [shownLabel, setShownLabel] = useState(initial.shownLabel);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  /** Set after mount so SSR and hydration share the same `src` (no `Date.now()` during render). */
  const [avatarBust, setAvatarBust] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "error" | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (avatarUrl) setAvatarBust(String(Date.now()));
    else setAvatarBust(null);
  }, [avatarUrl]);

  function previewShown(): string {
    if (name.trim()) return name.trim();
    return "Member";
  }

  function displayAvatarSrc(): string | null {
    if (previewUrl) return previewUrl;
    if (!avatarUrl) return null;
    if (!avatarBust) return avatarUrl;
    return `${avatarUrl}?t=${avatarBust}`;
  }

  async function patchPresence(patch: { presence?: HomePresence; statusMessage?: string | null }) {
    if (!initial.homeStatusId) return;
    await apiClient.patch(`/api/core/dashboard/home-status/${initial.homeStatusId}`, patch);
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setAvatarError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.postForm<{ ok: boolean; avatarUrl: string }>(
        "/api/core/profile/avatar",
        form,
      );
      setAvatarUrl(res.avatarUrl);
      setPreviewUrl(null);
    } catch (err) {
      setPreviewUrl(null);
      setAvatarError(
        err instanceof ApiError ? avatarErrorMessage(err.body) : "Upload failed",
      );
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    try {
      await apiClient.delete("/api/core/profile/avatar");
      setAvatarUrl(null);
    } catch (err) {
      setAvatarError(err instanceof ApiError ? avatarErrorMessage(err.body) : "Could not remove photo");
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <ProfileSection
          title="Identity"
          description={`Signed in as ${initial.username ? `@${initial.username}` : initial.email ?? "member"}. Shown to household as ${shownLabel}.`}
        >
          <div className="flex flex-wrap items-center gap-4">
            <Avatar
              id={initial.memberId}
              name={shownLabel}
              src={displayAvatarSrc()}
              size="lg"
            />
            <div className="flex min-w-[12rem] flex-1 flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                id="avatar-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAvatar(file);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={avatarBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {avatarUrl || previewUrl ? "Replace photo" : "Upload photo"}
                </Button>
                {(avatarUrl || previewUrl) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={avatarBusy}
                    onClick={() => void removeAvatar()}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                JPEG, PNG, or WebP · max 2 MB · resized to 256×256
              </p>
              {avatarError && (
                <Alert variant="error" className="text-sm">
                  {avatarError}
                </Alert>
              )}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Display name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} />
          </label>
        </ProfileSection>

        {initial.homeStatusId && (
          <ProfileSection
            title="Presence"
            description="Let the household know if you are home and what you are up to."
          >
            <RadioGroup
              legend="Home or away"
              name="presence"
              value={presence}
              onChange={async (v) => {
                const next = v as HomePresence;
                setPresence(next);
                try {
                  await patchPresence({
                    presence: next,
                    statusMessage: statusMessage.trim() || null,
                  });
                } catch {
                  /* saved on main Save */
                }
              }}
              options={[
                { value: "Home", label: "Home" },
                { value: "Away", label: "Away" },
              ]}
            />
            <label className="block space-y-1">
              <span className="text-sm text-[var(--color-text-muted)]">Status message</span>
              <Input
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value)}
                maxLength={64}
                placeholder="Optional — e.g. At work"
                onBlur={async () => {
                  try {
                    await patchPresence({
                      statusMessage: statusMessage.trim() || null,
                    });
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </label>
          </ProfileSection>
        )}

        <ProfileSection title="Preferences" description="Units and display defaults for your account.">
          <RadioGroup
            legend="Temperature"
            name="temperatureUnit"
            value={temperatureUnit}
            onChange={(v) => setTemperatureUnit(v as TemperatureUnit)}
            options={[
              { value: "fahrenheit", label: "Fahrenheit (°F)" },
              { value: "celsius", label: "Celsius (°C)" },
            ]}
          />
        </ProfileSection>

        {calendarIntegration ? (
          <ProfileSection
            title="Integrations"
            description="Connect external services used across the household."
          >
            <ProfileCalendarConnect
              oauthConfigured={calendarIntegration.oauthConfigured}
              defaultSyncMode={calendarIntegration.defaultSyncMode}
              connections={calendarIntegration.connections}
            />
          </ProfileSection>
        ) : null}

        <ProfileSection
          title="Notifications"
          description="Choose which Web Push alerts this browser and account receive."
          className="lg:col-span-2"
        >
          <div className="space-y-4">
            <NoticePushSettings
              initialEnabled={initial.pushNoticesEnabled}
              initialSubscribed={initial.pushSubscribed}
              pushAvailable={initial.pushAvailable}
            />
            <CalendarReminderPushSettings
              initialEnabled={initial.pushCalendarRemindersEnabled}
              pushAvailable={initial.pushAvailable}
            />
            <ChoreReminderPushSettings
              initialEnabled={initial.pushChoresRemindersEnabled}
              pushAvailable={initial.pushAvailable}
            />
            <ExpenseBudgetPushSettings
              initialEnabled={initial.pushExpenseBudgetAlertsEnabled}
              pushAvailable={initial.pushAvailable}
            />
          </div>
        </ProfileSection>

        {canManageHousehold ? (
          <ProfileSection
            title="Household admin"
            description="Manage members, timezone, and household name."
            className="lg:col-span-2"
          >
            <LinkButton href="/settings" variant="secondary" size="sm">
              Open household settings
            </LinkButton>
          </ProfileSection>
        ) : null}
      </div>

      <Card className="sticky bottom-0 z-10 border-[var(--color-border)] bg-[var(--color-surface-elevated)]/95 backdrop-blur-sm lg:static lg:backdrop-blur-none">
        <CardBody className="flex flex-wrap items-center gap-3 py-3 sm:py-4">
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              setMsg(null);
              setVariant(null);
              try {
                await apiClient.patch("/api/core/profile", {
                  name: name || null,
                  temperatureUnit,
                });
                if (initial.homeStatusId) {
                  await patchPresence({
                    presence,
                    statusMessage: statusMessage.trim() || null,
                  });
                }
                setShownLabel(previewShown());
                setMsg("Saved");
                setVariant("success");
              } catch (err) {
                setMsg(err instanceof ApiError ? err.message : "Failed");
                setVariant("error");
              } finally {
                setLoading(false);
              }
            }}
          >
            Save profile
          </Button>
          {msg && variant ? <Alert variant={variant}>{msg}</Alert> : null}
        </CardBody>
      </Card>
    </div>
  );
}
