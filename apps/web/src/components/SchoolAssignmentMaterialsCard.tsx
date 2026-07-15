"use client";

import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolClassAccess } from "../lib/school-access";
import type { SchoolMaterialDto } from "../lib/school-materials";
import {
  formatAttemptsRemaining,
  getMaterialActionLabel,
  materialOpenUrl,
  MATERIAL_ROLE_LABELS,
  nativeTestEditUrl,
  nativeTestTakeUrl,
} from "../lib/school-materials";
import { Alert, AnchorButton, Badge, Button, Card, CardBody, CardHeader } from "./ui";

interface GoogleCopyRow {
  materialId: string;
  openUrl: string;
}

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
  const isStudent = access.viewMode === "student";
  const attemptsLabel = formatAttemptsRemaining(maxAttempts, turnInCount ?? 0);
  const [copies, setCopies] = useState<GoogleCopyRow[]>([]);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [connectUrl, setConnectUrl] = useState(
    `/auth/google/docs/start?next=${encodeURIComponent(`/school/assignment/${assignmentId}`)}`,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingMaterialId, setStartingMaterialId] = useState<string | null>(null);

  const loadCopies = useCallback(async () => {
    if (!isStudent) return;
    try {
      const [copyData, readiness] = await Promise.all([
        apiClient.get<{ copies: GoogleCopyRow[] }>(
          `/api/school/assignments/${assignmentId}/google-copies`,
        ),
        apiClient.get<{ connected: boolean; connectUrl: string }>(
          `/api/school/assignments/${assignmentId}/google-readiness`,
        ),
      ]);
      setCopies(copyData.copies);
      setGoogleConnected(readiness.connected);
      setConnectUrl(readiness.connectUrl);
    } catch {
      setCopies([]);
      setGoogleConnected(false);
    }
  }, [assignmentId, isStudent]);

  useEffect(() => {
    void loadCopies();
  }, [loadCopies]);

  async function startTest(materialId: string) {
    if (googleConnected === false) {
      window.location.href = connectUrl;
      return;
    }
    setStartingMaterialId(materialId);
    setActionError(null);
    try {
      const data = await apiClient.post<{ copy: GoogleCopyRow }>(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/start-copy`,
        {},
      );
      setCopies((prev) => {
        const rest = prev.filter((c) => c.materialId !== materialId);
        return [...rest, data.copy];
      });
      window.open(data.copy.openUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (err instanceof ApiError && err.body?.includes("google_docs_not_connected")) {
        setActionError("Connect Google Docs in your profile, then try again.");
        setGoogleConnected(false);
      } else {
        setActionError(err instanceof ApiError ? err.message : "Could not start test");
      }
    } finally {
      setStartingMaterialId(null);
    }
  }

  if (materials.length === 0 && !attemptsLabel) return null;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={isStudent ? "text-base font-semibold" : "font-medium"}>
          {isStudent ? "Your assignment" : "Materials"}
        </h2>
        {attemptsLabel ? <Badge tone="accent">{attemptsLabel}</Badge> : null}
      </CardHeader>
      <CardBody className="space-y-3">
        {actionError ? <Alert variant="error">{actionError}</Alert> : null}
        {materials.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No materials attached.</p>
        ) : (
          <ul className="space-y-2">
            {materials.map((material) => {
              const copy = copies.find((c) => c.materialId === material.id);
              const isGoogleTest =
                material.source === "google_doc" && material.isTest && !material.frozenAt;
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
                      {material.source === "google_doc" ? (
                        <Badge tone="default">Google</Badge>
                      ) : null}
                      {material.source === "native_test" ? (
                        <Badge tone="accent">In-app</Badge>
                      ) : null}
                      {material.isTest ? <Badge tone="accent">Test</Badge> : null}
                      {material.frozenAt ? <Badge tone="warning">Frozen</Badge> : null}
                    </div>
                  </div>
                  {!isTeacher ? (
                    material.source === "native_test" ? (
                      access.canSubmit ? (
                        <AnchorButton
                          href={nativeTestTakeUrl(assignmentId, material.id)}
                          size="lg"
                          className="w-full sm:w-auto"
                        >
                          {label}
                        </AnchorButton>
                      ) : href ? (
                        <Button
                          size="lg"
                          className="w-full sm:w-auto"
                          onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                          View
                        </Button>
                      ) : null
                    ) : isGoogleTest ? (
                      copy ? (
                        <Button
                          size="lg"
                          className="w-full sm:w-auto"
                          onClick={() =>
                            window.open(copy.openUrl, "_blank", "noopener,noreferrer")
                          }
                        >
                          <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                          Open your copy
                        </Button>
                      ) : googleConnected === false ? (
                        <AnchorButton
                          href={connectUrl}
                          size="lg"
                          variant="secondary"
                          className="w-full sm:w-auto"
                        >
                          Connect Google Docs
                        </AnchorButton>
                      ) : (
                        <Button
                          size="lg"
                          className="w-full sm:w-auto"
                          loading={
                            startingMaterialId === material.id || googleConnected === null
                          }
                          disabled={
                            googleConnected !== true || startingMaterialId === material.id
                          }
                          onClick={() => void startTest(material.id)}
                        >
                          Start test
                        </Button>
                      )
                    ) : href ? (
                      <Button
                        size="lg"
                        className="w-full sm:w-auto"
                        onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                        {label}
                      </Button>
                    ) : null
                  ) : material.source === "native_test" && access.canEditAssignments ? (
                    <AnchorButton
                      href={nativeTestEditUrl(assignmentId, material.id)}
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                    >
                      {material.frozenAt ? "View test" : "Edit test"}
                    </AnchorButton>
                  ) : href ? (
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
