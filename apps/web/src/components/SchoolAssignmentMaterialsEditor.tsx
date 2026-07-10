"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolMaterialDto, SchoolMaterialRole } from "../lib/school-materials";
import { MATERIAL_ROLE_LABELS } from "../lib/school-materials";
import { SchoolTestQuestionEditor } from "./SchoolTestQuestionEditor";
import { DriveObjectPicker } from "./DriveObjectPicker";
import { GooglePickerButton } from "./GooglePickerButton";
import { Alert, Badge, Button, Checkbox, Input, Select } from "./ui";

interface MaterialEditorRow extends SchoolMaterialDto {
  _pending?: boolean;
}

export function SchoolAssignmentMaterialsEditor({
  assignmentId,
  driveEnabled,
  canEdit,
  assignmentPointsPossible,
}: {
  assignmentId: string;
  driveEnabled: boolean;
  canEdit: boolean;
  assignmentPointsPossible?: number | null;
}) {
  const [materials, setMaterials] = useState<MaterialEditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ materials: SchoolMaterialDto[] }>(
        `/api/school/assignments/${assignmentId}/materials`,
      );
      setMaterials(data.materials);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load materials");
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  async function addDriveMaterial(object: { id: string; title: string; kind: string }) {
    setError(null);
    try {
      await apiClient.post(`/api/school/assignments/${assignmentId}/materials`, {
        displayName: object.title,
        driveObjectId: object.id,
        role: "handout",
      });
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add material");
    }
  }

  async function addNativeTest() {
    setError(null);
    try {
      await apiClient.post(`/api/school/assignments/${assignmentId}/materials`, {
        source: "native_test",
        displayName: "In-app test",
        role: "student_material",
        isTest: true,
        nativeTestPointsMode: "explicit",
      });
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create in-app test");
    }
  }

  async function addGoogleMaterial(file: { id: string; name: string; mimeType: string }) {
    setError(null);
    try {
      await apiClient.post(`/api/school/assignments/${assignmentId}/materials`, {
        source: "google_doc",
        displayName: file.name,
        googleFileId: file.id,
        googleMimeType: file.mimeType,
        role: "handout",
      });
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add Google file");
    }
  }

  async function addLink() {
    if (!linkName.trim() || !linkUrl.trim()) return;
    setAddingLink(true);
    setError(null);
    try {
      await apiClient.post(`/api/school/assignments/${assignmentId}/materials`, {
        source: "external_url",
        displayName: linkName.trim(),
        externalUrl: linkUrl.trim(),
        role: "handout",
      });
      setLinkName("");
      setLinkUrl("");
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add link");
    } finally {
      setAddingLink(false);
    }
  }

  async function patchMaterial(id: string, patch: Record<string, unknown>) {
    setError(null);
    try {
      await apiClient.patch(`/api/school/assignments/${assignmentId}/materials/${id}`, patch);
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update material");
    }
  }

  async function removeMaterial(id: string) {
    setError(null);
    try {
      await apiClient.delete(`/api/school/assignments/${assignmentId}/materials/${id}`);
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove material");
    }
  }

  if (!canEdit) return null;

  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
      <div>
        <h3 className="text-sm font-medium">Materials</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Attach handouts, tests, rubrics, and answer keys for students.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading materials…</p>
      ) : materials.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No materials yet.</p>
      ) : (
        <ul className="space-y-3">
          {materials.map((m) => {
            const frozen = Boolean(m.frozenAt);
            return (
              <li
                key={m.id}
                className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{m.displayName}</span>
                  <Badge tone="default">{MATERIAL_ROLE_LABELS[m.role]}</Badge>
                  {m.source === "google_doc" ? <Badge tone="default">Google</Badge> : null}
                  {m.source === "native_test" ? <Badge tone="accent">In-app</Badge> : null}
                  {m.isTest ? <Badge tone="accent">Test</Badge> : null}
                  {frozen ? <Badge tone="warning">Frozen</Badge> : null}
                </div>
                {!frozen ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={m.role}
                      onChange={(e) =>
                        void patchMaterial(m.id, { role: e.target.value as SchoolMaterialRole })
                      }
                      aria-label="Material role"
                    >
                      {(Object.keys(MATERIAL_ROLE_LABELS) as SchoolMaterialRole[]).map((role) => (
                        <option key={role} value={role}>
                          {MATERIAL_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                    <div className="flex flex-col gap-2">
                      <Checkbox
                        label="Mark as test"
                        checked={m.isTest}
                        onChange={(e) => void patchMaterial(m.id, { isTest: e.target.checked })}
                      />
                      {m.isTest && m.source === "google_doc" ? (
                        <Checkbox
                          label="Strict content check"
                          checked={m.strictContentCheck ?? false}
                          onChange={(e) =>
                            void patchMaterial(m.id, { strictContentCheck: e.target.checked })
                          }
                        />
                      ) : null}
                      {m.role !== "answer_key" ? (
                        <>
                          <Checkbox
                            label="Student can view"
                            checked={m.studentVisible}
                            onChange={(e) =>
                              void patchMaterial(m.id, { studentVisible: e.target.checked })
                            }
                          />
                          <Checkbox
                            label="Observers can view"
                            checked={m.observerVisible}
                            onChange={(e) =>
                              void patchMaterial(m.id, { observerVisible: e.target.checked })
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {m.source === "native_test" ? (
                  <SchoolTestQuestionEditor
                    assignmentId={assignmentId}
                    materialId={m.id}
                    pointsMode={m.nativeTestPointsMode ?? "explicit"}
                    assignmentPointsPossible={assignmentPointsPossible ?? null}
                    frozen={frozen}
                    onPointsModeChange={async (mode) => {
                      await patchMaterial(m.id, { nativeTestPointsMode: mode });
                    }}
                  />
                ) : null}
                {!frozen ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void removeMaterial(m.id)}>
                    Remove
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => void addNativeTest()}>
          Create in-app test
        </Button>
        {driveEnabled ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
            Add from Drive
          </Button>
        ) : null}
        <GooglePickerButton onPicked={addGoogleMaterial} title="Attach Google file to assignment" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Link title"
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          aria-label="Link title"
        />
        <Input
          placeholder="https://…"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          aria-label="External URL"
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={addingLink}
        disabled={!linkName.trim() || !linkUrl.trim()}
        onClick={() => void addLink()}
      >
        Add link
      </Button>

      {driveEnabled ? (
        <DriveObjectPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="Attach Drive file to assignment"
          excludeIds={materials.map((m) => m.driveObjectId).filter(Boolean) as string[]}
          onSelect={(object) => {
            void addDriveMaterial(object);
          }}
        />
      ) : null}
    </div>
  );
}
