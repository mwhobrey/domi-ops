"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { HOUSEHOLD_TIMEZONE_OPTIONS } from "../lib/timezones";
import { Alert, Button, Card, CardBody, Input, SectionHeader, Select } from "./ui";

type HouseholdSettings = {
  name: string;
  slug: string | null;
  timezone: string;
  modulesEnabled: string[];
};

export function HouseholdSettingsEditor({ initial }: { initial: HouseholdSettings }) {
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [timezone, setTimezone] = useState(initial.timezone);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "error" | null>(null);

  const timezoneOptions = HOUSEHOLD_TIMEZONE_OPTIONS.includes(
    timezone as (typeof HOUSEHOLD_TIMEZONE_OPTIONS)[number],
  )
    ? HOUSEHOLD_TIMEZONE_OPTIONS
    : ([...HOUSEHOLD_TIMEZONE_OPTIONS, timezone] as const);

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

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-inset)] px-3 py-2">
          <p className="text-label text-[var(--color-text-muted)]">Enabled modules</p>
          <p className="mt-1 text-sm">
            {initial.modulesEnabled.length > 0
              ? initial.modulesEnabled.join(", ")
              : "core"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Module toggles are env-controlled today; per-household switches are planned.
          </p>
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
              });
              setName(res.household.name);
              setSlug(res.household.slug ?? "");
              setTimezone(res.household.timezone);
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
