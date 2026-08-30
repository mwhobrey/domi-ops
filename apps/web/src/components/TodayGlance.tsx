"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../lib/client-api";
import { formatChoreDueMeta, formatSchoolDueMeta } from "../lib/glance-meta";
import type { GlancePreviewItem } from "./ui";
import { Card, CardBody, CardHeader, GlanceTile, SectionHeader, Skeleton } from "./ui";

type GlanceTone = "default" | "warning" | "success";

type ChoresGlance = {
  summary: { headline: string; tone: GlanceTone };
  items: { id: string; description: string; dueDate: string | null }[];
  overflow: number;
};

type SchoolGlance = {
  enabled: boolean;
  summary?: { headline: string; tone: GlanceTone };
  items?: { id: string; title: string; className: string; dueAt: string; overdue: boolean }[];
  overflow?: number;
};

type ShoppingGlance = {
  summary: { headline: string; tone: GlanceTone };
  items: { id: string; item: string; meta?: string }[];
  overflow: number;
};

type HealthGlance = {
  enabled?: boolean;
  pendingDoses?: {
    medicationId: string;
    name: string;
    dosage: string | null;
    scheduledAt: string;
    scheduledTimeLabel: string;
    awaitingFirst?: boolean;
  }[];
};

type GlanceTileModel = {
  key: string;
  label: string;
  href: string;
  headline: string;
  tone: GlanceTone;
  items: GlancePreviewItem[];
  overflowCount: number;
  emptyHint?: string;
};

const toneRank: Record<GlanceTone, number> = {
  warning: 0,
  default: 1,
  success: 2,
};

function buildHealthTile(glance: HealthGlance | null): GlanceTileModel | null {
  if (!glance) return null;
  const pending = glance.pendingDoses ?? [];
  const now = Date.now();
  const overdueCount = pending.filter((d) => {
    if (d.awaitingFirst) return false;
    const at = Date.parse(d.scheduledAt);
    return Number.isFinite(at) && at < now;
  }).length;

  let headline: string;
  let tone: GlanceTone;
  if (pending.length === 0) {
    headline = "All clear";
    tone = "success";
  } else if (overdueCount > 0) {
    headline = `${overdueCount} overdue`;
    tone = "warning";
  } else {
    headline = `${pending.length} dose${pending.length === 1 ? "" : "s"}`;
    tone = "default";
  }

  return {
    key: "health",
    label: "Health",
    href: "/health",
    headline,
    tone,
    items: pending.slice(0, 3).map((d) => {
      const at = Date.parse(d.scheduledAt);
      const late = !d.awaitingFirst && Number.isFinite(at) && at < now;
      return {
        key: `${d.medicationId}-${d.scheduledTimeLabel}`,
        label: d.name,
        meta: [late ? "Overdue" : d.scheduledTimeLabel, d.dosage, d.awaitingFirst ? "Start" : null]
          .filter(Boolean)
          .join(" · "),
        href: `/health?take=${encodeURIComponent(d.medicationId)}&scheduledAt=${encodeURIComponent(d.scheduledAt)}`,
      };
    }),
    overflowCount: Math.max(0, pending.length - 3),
    emptyHint: tone === "success" ? "No doses pending today." : undefined,
  };
}

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function TodayGlance({
  schoolModuleEnabled = false,
  healthModuleEnabled = false,
  glanceConfig = null,
}: {
  schoolModuleEnabled?: boolean;
  healthModuleEnabled?: boolean;
  /** Per-member tile visibility + order (GlanceConfigCard.tsx, /profile). Null = no preference
   *  set — falls back to showing every currently-available tile, sorted by urgency. */
  glanceConfig?: string[] | null;
}) {
  const [loading, setLoading] = useState(true);
  const [chores, setChores] = useState<ChoresGlance | null>(null);
  const [school, setSchool] = useState<SchoolGlance | null>(null);
  const [shopping, setShopping] = useState<ShoppingGlance | null>(null);
  const [health, setHealth] = useState<HealthGlance | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const narrow = useNarrowViewport();

  useEffect(() => {
    (async () => {
      try {
        const [choresRes, shoppingRes, schoolRes, healthRes] = await Promise.all([
          apiClient.get<ChoresGlance>("/api/core/chores/glance"),
          apiClient.get<ShoppingGlance>("/api/core/shopping/glance"),
          schoolModuleEnabled
            ? apiClient.get<SchoolGlance>("/api/school/glance").catch(() => ({ enabled: false }))
            : Promise.resolve({ enabled: false } as SchoolGlance),
          healthModuleEnabled
            ? apiClient
                .get<HealthGlance>("/api/health/glance")
                .catch(() => ({ enabled: false, pendingDoses: [] }))
            : Promise.resolve(null),
        ]);
        setChores(choresRes);
        setShopping(shoppingRes);
        setSchool(schoolRes.enabled ? schoolRes : null);
        setHealth(healthModuleEnabled ? healthRes : null);
      } catch {
        /* ignore widget errors */
      } finally {
        setLoading(false);
      }
    })();
  }, [schoolModuleEnabled, healthModuleEnabled]);

  const tiles = useMemo(() => {
    const built: GlanceTileModel[] = [];
    if (chores) {
      built.push({
        key: "chores",
        label: "Chores",
        href: "/chores",
        headline: chores.summary.headline,
        tone: chores.summary.tone,
        items: chores.items.map((c) => ({
          key: c.id,
          label: c.description,
          meta: formatChoreDueMeta(c.dueDate, today),
          href: `/chores?highlight=${c.id}`,
        })),
        overflowCount: chores.overflow,
        emptyHint: chores.summary.tone === "success" ? "Nothing open right now." : undefined,
      });
    }
    if (shopping) {
      built.push({
        key: "shopping",
        label: "Shopping",
        href: "/shopping",
        headline: shopping.summary.headline,
        tone: shopping.summary.tone,
        items: shopping.items.map((s) => ({
          key: s.id,
          label: s.item,
          meta: s.meta,
        })),
        overflowCount: shopping.overflow,
        emptyHint: shopping.summary.tone === "success" ? "No open shopping items." : undefined,
      });
    }
    if (school?.summary) {
      built.push({
        key: "school",
        label: "School",
        href: "/school",
        headline: school.summary.headline,
        tone: school.summary.tone,
        items: (school.items ?? []).map((a) => ({
          key: a.id,
          label: a.title,
          meta: `${a.className} · ${formatSchoolDueMeta(a.dueAt, a.overdue)}`,
          href: `/school/assignment/${a.id}`,
        })),
        overflowCount: school.overflow ?? 0,
        emptyHint:
          school.summary.headline === "Set up"
            ? "Add a class to get started."
            : school.summary.tone === "success"
              ? "No urgent assignments."
              : undefined,
      });
    }
    const healthTile = buildHealthTile(health);
    if (healthTile) built.push(healthTile);

    // A member's explicit choice (GlanceConfigCard) wins outright — their order, only their
    // chosen tiles (a stale key for a since-disabled module just quietly filters out, since
    // `built` never contains a tile that isn't currently available in the first place), and no
    // automatic urgency re-sorting or narrow-viewport hiding second-guessing what they picked.
    if (glanceConfig) {
      const byKey = new Map(built.map((t) => [t.key, t]));
      return glanceConfig.map((k) => byKey.get(k)).filter((t): t is GlanceTileModel => t !== undefined);
    }

    built.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || a.label.localeCompare(b.label));

    const hasActionable = built.some((t) => t.tone !== "success");
    if (narrow && hasActionable) {
      return built.filter((t) => t.tone !== "success");
    }
    return built;
  }, [chores, shopping, school, health, today, narrow, glanceConfig]);

  const hiddenClearCount = useMemo(() => {
    if (!narrow || glanceConfig) return 0;
    const all: GlanceTone[] = [];
    if (chores) all.push(chores.summary.tone);
    if (shopping) all.push(shopping.summary.tone);
    if (school?.summary) all.push(school.summary.tone);
    const ht = buildHealthTile(health);
    if (ht) all.push(ht.tone);
    const actionable = all.some((t) => t !== "success");
    if (!actionable) return 0;
    return all.filter((t) => t === "success").length;
  }, [narrow, chores, shopping, school, health, glanceConfig]);

  const gridClass =
    tiles.length <= 1
      ? "grid gap-3"
      : "grid gap-3 sm:grid-cols-2"; /* 2×2 max — 4-across at xl was too cramped */

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Today at a glance" />
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className={gridClass}>
            {Array.from({ length: Math.max(tiles.length, 2) }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className={gridClass}>
              {tiles.map((tile) => (
                <GlanceTile
                  key={tile.key}
                  label={tile.label}
                  headline={tile.headline}
                  href={tile.href}
                  tone={tile.tone}
                  items={tile.items}
                  overflowCount={tile.overflowCount}
                  emptyHint={tile.emptyHint}
                />
              ))}
            </div>
            {hiddenClearCount > 0 ? (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                {hiddenClearCount} other module{hiddenClearCount === 1 ? "" : "s"} clear today
              </p>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
