"use client";

import { ExternalLink } from "lucide-react";
import type { SchoolClassAccess } from "../lib/school-access";
import type { SchoolMaterialDto } from "../lib/school-materials";
import {
  formatAttemptsRemaining,
  getMaterialActionLabel,
  materialOpenUrl,
  MATERIAL_ROLE_LABELS,
} from "../lib/school-materials";
import { Badge, Button, Card, CardBody, CardHeader } from "./ui";

export function SchoolAssignmentMaterialsCard({
  assignmentId,
  materials,
  access,
  maxAttempts,
  turnInCount,
}: {
  assignmentId: string;
  materials: SchoolMaterialDto[];
  access: SchoolClassAccess;
  maxAttempts?: number | null;
  turnInCount?: number;
}) {
  const isTeacher = access.viewMode === "admin" || access.viewMode === "staff";
  const attemptsLabel = formatAttemptsRemaining(maxAttempts, turnInCount ?? 0);

  if (materials.length === 0 && !attemptsLabel) return null;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={access.viewMode === "student" ? "text-base font-semibold" : "font-medium"}>
          {access.viewMode === "student" ? "Your assignment" : "Materials"}
        </h2>
        {attemptsLabel ? <Badge tone="accent">{attemptsLabel}</Badge> : null}
      </CardHeader>
      <CardBody className="space-y-3">
        {materials.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No materials attached.</p>
        ) : (
          <ul className="space-y-2">
            {materials.map((material) => {
              const href = materialOpenUrl(assignmentId, material);
              const label = getMaterialActionLabel(material);
              return (
                <li
                  key={material.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{material.displayName}</p>
                    <div className="flex flex-wrap gap-2">
                      {isTeacher ? (
                        <Badge tone="default">{MATERIAL_ROLE_LABELS[material.role]}</Badge>
                      ) : null}
                      {material.isTest ? <Badge tone="accent">Test</Badge> : null}
                      {material.frozenAt ? <Badge tone="warning">Frozen</Badge> : null}
                    </div>
                  </div>
                  {href && !isTeacher ? (
                    <Button
                      size="lg"
                      className="w-full sm:w-auto"
                      onClick={() => {
                        if (href.startsWith("/api/")) {
                          window.open(href, "_blank", "noopener,noreferrer");
                        } else {
                          window.open(href, "_blank", "noopener,noreferrer");
                        }
                      }}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                      {label}
                    </Button>
                  ) : href && isTeacher ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--color-accent)] underline"
                    >
                      Open
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
