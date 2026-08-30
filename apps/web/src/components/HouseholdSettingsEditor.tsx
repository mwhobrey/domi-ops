"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { HOUSEHOLD_TIMEZONE_OPTIONS } from "../lib/timezones";
import { DriveStoragePanel } from "./DriveStoragePanel";
import type { DriveStorageInfo } from "../lib/drive-types";
import { Alert, Button, Card, CardBody, Checkbox, Input, SectionHeader, Select } from "./ui";

type DrivePermissionLevel = "none" | "read" | "write";

type DriveRolePermissions = Partial<Record<"member" | "child" | "guest", DrivePermissionLevel>>;

type HouseholdSettings = {
  name: string;
  slug: string | null;
  timezone: string;
  modulesEnabled: string[];
  availableModules: string[];
  modulesEntitled?: string[] | null;
  drivePermissions?: DriveRolePermissions;
  drivePermissionDefaults?: DriveRolePermissions;
  driveStorage?: DriveStorageInfo | null;
  drivePublicSharesEnabled?: boolean;
  telemetryOptIn?: boolean;
};

const DRIVE_ROLE_LABELS: Record<"member" | "child" | "guest", string> = {
  member: "Member",
  child: "Child",
  guest: "Guest",
};

const MODULE_META: Record<string, { label: string; description: string; locked?: boolean }> = {
  core: {
    label: "Core",
    description: "Dashboard, shopping, chores, notes, and expenses",
    locked: true,
  },
  school: {
    label: "School",
    description: "Homeschool classes, assignments, and gradebook",
  },
  calendar_sync: {
    label: "Calendar sync",
    description: "Google Calendar import and bidirectional sync",
  },
  drive: {
    label: "Drive",
    description: "Household file and link storage (MinIO-backed)",
  },
  health: {
    label: "Health",
    description: "Symptoms, medications, and household health tracking",
  },
};

export function HouseholdSettingsEditor({ initial }: { initial: HouseholdSettings }) {
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [timezone, setTimezone] = useState(initial.timezone);
  const [modulesEnabled, setModulesEnabled] = useState<string[]>(initial.modulesEnabled);
  const [drivePermissions, setDrivePermissions] = useState<DriveRolePermissions>(
    initial.drivePermissions ?? initial.drivePermissionDefaults ?? {},
  );
  const [telemetryOptIn, setTelemetryOptIn] = useState(initial.telemetryOptIn ?? false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "error" | null>(null);

  const timezoneOptions = HOUSEHOLD_TIMEZONE_OPTIONS.includes(
    timezone as (typeof HOUSEHOLD_TIMEZONE_OPTIONS)[number],
  )
    ? HOUSEHOLD_TIMEZONE_OPTIONS
    : ([...HOUSEHOLD_TIMEZONE_OPTIONS, timezone] as const);

  const toggleableModules = initial.availableModules.filter((m) => m !== "core");

  // Modules known to the client but not in the entitlement ceiling (hosted only)
  const lockedModules =
    initial.modulesEntitled !== undefined && initial.modulesEntitled !== null
      ? Object.keys(MODULE_META).filter(
          (m) => m !== "core" && !initial.availableModules.includes(m),
        )
      : [];

  function toggleModule(module: string, checked: boolean) {
    setModulesEnabled((prev) => {
      const next = new Set(prev);
      next.add("core");
      if (checked) next.add(module);
      else next.delete(module);
      return [...next];
    });
  }

  return (
    <Card>
      <CardBody className="space-y-6">
        <SectionHeader title="Household details" />
        <p className="text-sm text-[var(--color-text-muted)]">
          Name and timezone apply across the dashboard, calendar defaults, and reports.
        </p>

        <label className="block space-y-1" data-tour="household-name">
          <span className="text-sm font-medium">Household name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            required
            autoComplete="organization"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Slug</span>
          <span className="block text-xs text-[var(--color-text-muted)]">
            Optional short id for URLs and exports (letters, numbers, hyphens).
          </span>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={64}
            pattern="[a-z0-9-]*"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="block space-y-1" data-tour="household-timezone">
          <span className="text-sm font-medium">Timezone</span>
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </label>

        <div className="space-y-3" data-tour="modules-section">
          <div className="space-y-1">
            <p className="text-sm font-medium">Enabled modules</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Turn optional modules on or off for this household. Core is always on. Server env may
              limit which modules can be enabled.
            </p>
          </div>
          <ul className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            {initial.availableModules.map((module) => {
              const meta = MODULE_META[module] ?? { label: module, description: "" };
              const checked = modulesEnabled.includes(module);
              const disabled = meta.locked === true;
              return (
                <li key={module}>
                  <Checkbox
                    id={`module-${module}`}
                    label={
                      <span>
                        <span className="font-medium">{meta.label}</span>
                        {meta.description ? (
                          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                            {meta.description}
                          </span>
                        ) : null}
                      </span>
                    }
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => toggleModule(module, e.target.checked)}
                  />
                </li>
              );
            })}
            {lockedModules.map((module) => {
              const meta = MODULE_META[module] ?? { label: module, description: "" };
              return (
                <li key={module} className="opacity-50">
                  <Checkbox
                    id={`module-locked-${module}`}
                    label={
                      <span>
                        <span className="inline-flex items-center gap-2 font-medium">
                          {meta.label}
                          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-normal text-[var(--color-text-muted)]">
                            Not in your plan
                          </span>
                        </span>
                        {meta.description ? (
                          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                            {meta.description}
                          </span>
                        ) : null}
                      </span>
                    }
                    checked={false}
                    disabled
                    onChange={() => undefined}
                  />
                </li>
              );
            })}
            {toggleableModules.length === 0 && lockedModules.length === 0 ? (
              <li className="text-sm text-[var(--color-text-muted)]">
                No optional modules are available on this server.
              </li>
            ) : null}
          </ul>
        </div>

        {initial.availableModules.includes("drive") && modulesEnabled.includes("drive") ? (
          <DriveStoragePanel
            initialStorage={initial.driveStorage ?? null}
            publicSharesEnabled={initial.drivePublicSharesEnabled}
          />
        ) : null}

        {initial.availableModules.includes("drive") ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Drive permissions</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Per-role access when the Drive module is enabled. Owner and admin always have full
                access.
              </p>
            </div>
            <ul className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
              {(["member", "child", "guest"] as const).map((role) => (
                <li key={role} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{DRIVE_ROLE_LABELS[role]}</span>
                  <Select
                    aria-label={`Drive permission for ${DRIVE_ROLE_LABELS[role]}`}
                    value={drivePermissions[role] ?? initial.drivePermissionDefaults?.[role] ?? "read"}
                    onChange={(e) =>
                      setDrivePermissions((prev) => ({
                        ...prev,
                        [role]: e.target.value as DrivePermissionLevel,
                      }))
                    }
                  >
                    <option value="none">No access</option>
                    <option value="read">Read only</option>
                    <option value="write">Read & write</option>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Privacy</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Off by default — no data leaves this household unless you turn this on.
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <Checkbox
              id="telemetry-opt-in"
              label={
                <span>
                  <span className="font-medium">Help improve Domi Ops</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    Sends anonymized technical and usage metrics (page load speed, errors,
                    which features get used) — never note/health/expense content, never linked
                    back to your household or account, never sold. Read more in the{" "}
                    <a href="/privacy" className="underline">
                      Privacy Policy
                    </a>
                    .
                  </span>
                </span>
              }
              checked={telemetryOptIn}
              onChange={(e) => setTelemetryOptIn(e.target.checked)}
            />
          </div>
        </div>

        <Button
          loading={loading}
          onClick={async () => {
            setLoading(true);
            setMsg(null);
            setVariant(null);
            try {
              const res = await apiClient.patch<{
                ok: boolean;
                household: HouseholdSettings;
              }>("/api/core/household/settings", {
                name: name.trim(),
                slug: slug.trim() || null,
                timezone: timezone.trim(),
                modulesEnabled,
                drivePermissions,
                telemetryOptIn,
              });
              setName(res.household.name);
              setSlug(res.household.slug ?? "");
              setTimezone(res.household.timezone);
              setModulesEnabled(res.household.modulesEnabled);
              if (res.household.drivePermissions) {
                setDrivePermissions(res.household.drivePermissions);
              }
              setTelemetryOptIn(res.household.telemetryOptIn ?? false);
              setMsg("Household settings saved");
              setVariant("success");
            } catch (err) {
              setMsg(err instanceof ApiError ? err.message : "Could not save settings");
              setVariant("error");
            } finally {
              setLoading(false);
            }
          }}
        >
          Save household settings
        </Button>
        {msg && variant && <Alert variant={variant}>{msg}</Alert>}
      </CardBody>
    </Card>
  );
}
