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

type DriveGlance = {
  enabled: boolean;
  summary?: { headline: string; tone: "default" | "warning" | "success" };
  items?: { id: string; title: string; kind: string; pinned: boolean }[];
  overflow?: number;
};

export function TodayGlance({ driveModuleEnabled = false }: { driveModuleEnabled?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [chores, setChores] = useState<ChoresGlance | null>(null);
  const [school, setSchool] = useState<SchoolGlance | null>(null);
  const [drive, setDrive] = useState<DriveGlance | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    (async () => {
      try {
        const [choresRes, schoolRes, driveRes] = await Promise.all([
          apiClient.get<ChoresGlance>("/api/core/chores/glance"),
          apiClient.get<SchoolGlance>("/api/school/glance").catch(() => ({ enabled: false })),
          driveModuleEnabled
            ? apiClient.get<DriveGlance>("/api/core/drive/glance").catch(() => ({ enabled: false }))
            : Promise.resolve({ enabled: false } as DriveGlance),
        ]);
        setChores(choresRes);
        setSchool(schoolRes.enabled ? schoolRes : null);
        setDrive(driveRes.enabled ? driveRes : null);
      } catch {
        /* ignore widget errors */
      } finally {
        setLoading(false);
      }
    })();
  }, [driveModuleEnabled]);

  const columnCount = [school, drive].filter(Boolean).length + 1;

  return (
    <Card className="h-full">
      <CardHeader>
        <SectionHeader title="Today at a glance" />
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className={`grid gap-3 ${columnCount > 1 ? "sm:grid-cols-2" : ""}`}>
            <Skeleton className="h-28 w-full" />
            {columnCount > 1 ? <Skeleton className="h-28 w-full" /> : null}
            {columnCount > 2 ? <Skeleton className="h-28 w-full sm:col-span-2" /> : null}
          </div>
        ) : (
          <div
            className={`grid gap-3 ${columnCount > 1 ? "sm:grid-cols-2" : ""} ${columnCount > 2 ? "lg:grid-cols-3" : ""}`}
          >
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
            {drive?.summary && (
              <GlanceTile
                label="Drive"
                headline={drive.summary.headline}
                href="/drive"
                tone={drive.summary.tone}
                items={(drive.items ?? []).map((item) => ({
                  key: item.id,
                  label: item.title,
                  meta: item.pinned ? "Pinned" : item.kind === "link" ? "Link" : "File",
                }))}
                overflowCount={drive.overflow ?? 0}
                emptyHint={
                  drive.summary.tone === "success" ? "Upload files or add links." : undefined
                }
              />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
