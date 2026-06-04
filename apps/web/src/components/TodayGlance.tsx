"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/client-api";
import { formatChoreDueMeta, formatSchoolDueMeta } from "../lib/glance-meta";
import { Card, CardBody, CardHeader, GlanceTile, SectionHeader, Skeleton } from "./ui";

type ChoresGlance = {
  summary: {
    headline: string;
    tone: "default" | "warning" | "success";
  };
  items: { id: string; description: string; dueDate: string | null }[];
  overflow: number;
};

type SchoolGlance = {
  enabled: boolean;
  summary?: { headline: string; tone: "default" | "warning" | "success" };
  items?: { id: string; title: string; className: string; dueAt: string; overdue: boolean }[];
  overflow?: number;
};

export function TodayGlance() {
  const [loading, setLoading] = useState(true);
  const [chores, setChores] = useState<ChoresGlance | null>(null);
  const [school, setSchool] = useState<SchoolGlance | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    (async () => {
      try {
        const [choresRes, schoolRes] = await Promise.all([
          apiClient.get<ChoresGlance>("/api/core/chores/glance"),
          apiClient.get<SchoolGlance>("/api/school/glance").catch(() => ({ enabled: false })),
        ]);
        setChores(choresRes);
        setSchool(schoolRes.enabled ? schoolRes : null);
      } catch {
        /* ignore widget errors */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <SectionHeader title="Today at a glance" />
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className={`grid gap-3 ${school ? "sm:grid-cols-2" : ""}`}>
            {chores && (
              <GlanceTile
                label="Chores"
                headline={chores.summary.headline}
                href="/chores"
                tone={chores.summary.tone}
                items={chores.items.map((c) => ({
                  key: c.id,
                  label: c.description,
                  meta: formatChoreDueMeta(c.dueDate, today),
                }))}
                overflowCount={chores.overflow}
                emptyHint={chores.summary.tone === "success" ? "Nothing open right now." : undefined}
              />
            )}
            {school?.summary && (
              <GlanceTile
                label="School"
                headline={school.summary.headline}
                href="/school"
                tone={school.summary.tone}
                items={(school.items ?? []).map((a) => ({
                  key: a.id,
                  label: a.title,
                  meta: `${a.className} · ${formatSchoolDueMeta(a.dueAt, a.overdue)}`,
                }))}
                overflowCount={school.overflow ?? 0}
                emptyHint={
                  school.summary.headline === "Set up"
                    ? "Add a class to get started."
                    : school.summary.tone === "success"
                      ? "No urgent assignments."
                      : undefined
                }
              />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
