"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { HOUSEHOLD_TIMEZONE_OPTIONS } from "../lib/timezones";
import { Alert, Button, Card, CardBody, Checkbox, Input, SectionHeader, Select } from "./ui";

type HouseholdSettings = {
  name: string;
  slug: string | null;
  timezone: string;
  modulesEnabled: string[];
  availableModules: string[];
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
};

export function HouseholdSettingsEditor({ initial }: { initial: HouseholdSettings }) {
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [timezone, setTimezone] = useState(initial.timezone);
  const [modulesEnabled, setModulesEnabled] = useState<string[]>(initial.modulesEnabled);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "error" | null>(null);

  const timezoneOptions = HOUSEHOLD_TIMEZONE_OPTIONS.includes(
    timezone as (typeof HOUSEHOLD_TIMEZONE_OPTIONS)[number],
  )
    ? HOUSEHOLD_TIMEZONE_OPTIONS
    : ([...HOUSEHOLD_TIMEZONE_OPTIONS, timezone] as const);

  const toggleableModules = initial.availableModules.filter((m) => m !== "core");

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

        <label className="block space-y-1">
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

        <label className="block space-y-1">
          <span className="text-sm font-medium">Timezone</span>
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </label>

        <div className="space-y-3">
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
            {toggleableModules.length === 0 ? (
              <li className="text-sm text-[var(--color-text-muted)]">
                No optional modules are available on this server.
              </li>
            ) : null}
          </ul>
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
              });
              setName(res.household.name);
              setSlug(res.household.slug ?? "");
              setTimezone(res.household.timezone);
              setModulesEnabled(res.household.modulesEnabled);
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
