"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolMaterialDto, SchoolMaterialRole } from "../lib/school-materials";
import { MATERIAL_ROLE_LABELS, nativeTestEditUrl } from "../lib/school-materials";
import { DriveObjectPicker } from "./DriveObjectPicker";
import { GooglePickerButton } from "./GooglePickerButton";
import { Alert, AnchorButton, Badge, Button, Checkbox, Input, Modal, Select } from "./ui";

interface MaterialEditorRow extends SchoolMaterialDto {
  _pending?: boolean;
}

type ConvertPreviewQuestion = {
  questionType: string;
  promptMarkdown: string;
  points: number;
  optionsJson: Array<{ id: string; label: string }> | null;
  correctAnswerJson: Record<string, unknown> | null;
  needsReview: boolean;
  parseNotes: string[];
};

type ConvertPreview = {
  sourceMaterial: { id: string; displayName: string; openUrl: string | null };
  questionCount: number;
  warnings: string[];
  questions: ConvertPreviewQuestion[];
};

function apiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (!err.body) return err.message;
  try {
    const parsed = JSON.parse(err.body) as { message?: string; error?: string };
    return parsed.message || parsed.error || err.message;
  } catch {
    return err.message;
  }
}

function canConvertMaterial(m: SchoolMaterialDto): boolean {
  return (
    m.source === "google_doc" ||
    m.source === "domi_drive_file" ||
    m.source === "domi_drive_link"
  );
}

export function SchoolAssignmentMaterialsEditor({
  assignmentId,
  ensureAssignment,
  driveEnabled,
  canEdit,
  assignmentPointsPossible,
}: {
  assignmentId: string | null;
  ensureAssignment?: () => Promise<string | null>;
  driveEnabled: boolean;
  canEdit: boolean;
  assignmentPointsPossible?: number | null;
}) {
  const router = useRouter();
  const [materials, setMaterials] = useState<MaterialEditorRow[]>([]);
  const [loading, setLoading] = useState(Boolean(assignmentId));
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [creatingTest, setCreatingTest] = useState(false);
  const [convertMaterialId, setConvertMaterialId] = useState<string | null>(null);
  const [convertPreview, setConvertPreview] = useState<ConvertPreview | null>(null);
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertSaving, setConvertSaving] = useState(false);

  const loadMaterials = useCallback(async (id = assignmentId) => {
    if (!id) {
      setMaterials([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ materials: SchoolMaterialDto[] }>(
        `/api/school/assignments/${id}/materials`,
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

  async function resolveAssignmentId(): Promise<string | null> {
    if (assignmentId) return assignmentId;
    return ensureAssignment?.() ?? null;
  }

  async function addDriveMaterial(object: { id: string; title: string; kind: string }) {
    setError(null);
    try {
      const id = await resolveAssignmentId();
      if (!id) return;
      await apiClient.post(`/api/school/assignments/${id}/materials`, {
        displayName: object.title,
        driveObjectId: object.id,
        role: "handout",
      });
      await loadMaterials(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add material");
    }
  }

  async function addNativeTest() {
    setError(null);
    setCreatingTest(true);
    try {
      const id = await resolveAssignmentId();
      if (!id) {
        setCreatingTest(false);
        return;
      }
      const created = await apiClient.post<{ material: SchoolMaterialDto }>(
        `/api/school/assignments/${id}/materials`,
        {
          source: "native_test",
          displayName: "In-app test",
          role: "student_material",
          isTest: true,
          nativeTestPointsMode: "explicit",
        },
      );
      router.push(nativeTestEditUrl(id, created.material.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create in-app test");
      setCreatingTest(false);
    }
  }

  async function addGoogleMaterial(
    file: { id: string; name: string; mimeType: string },
    convertAfterAttach = false,
  ) {
    setError(null);
    try {
      const id = await resolveAssignmentId();
      if (!id) return;
      const created = await apiClient.post<{ material: SchoolMaterialDto }>(
        `/api/school/assignments/${id}/materials`,
        {
          source: "google_doc",
          displayName: file.name,
          googleFileId: file.id,
          googleMimeType: file.mimeType,
          role: "handout",
          isTest: false,
        },
      );
      await loadMaterials(id);
      if (convertAfterAttach) {
        await openConvert(created.material.id, id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add Google file");
    }
  }

  async function addLink() {
    if (!linkName.trim() || !linkUrl.trim()) return;
    setAddingLink(true);
    setError(null);
    try {
      const id = await resolveAssignmentId();
      if (!id) return;
      await apiClient.post(`/api/school/assignments/${id}/materials`, {
        source: "external_url",
        displayName: linkName.trim(),
        externalUrl: linkUrl.trim(),
        role: "handout",
      });
      setLinkName("");
      setLinkUrl("");
      await loadMaterials(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add link");
    } finally {
      setAddingLink(false);
    }
  }

  async function patchMaterial(id: string, patch: Record<string, unknown>) {
    if (!assignmentId) return;
    setError(null);
    try {
      await apiClient.patch(`/api/school/assignments/${assignmentId}/materials/${id}`, patch);
      await loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update material");
    }
  }

  async function removeMaterial(id: string) {
    if (!assignmentId) return;
    setError(null);
    try {
      await apiClient.delete(`/api/school/assignments/${assignmentId}/materials/${id}`);
      await loadMaterials();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not remove material"));
    }
  }

  async function openConvert(materialId: string, resolvedAssignmentId = assignmentId) {
    if (!resolvedAssignmentId) return;
    setConvertMaterialId(materialId);
    setConvertPreview(null);
    setConvertLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<ConvertPreview>(
        `/api/school/assignments/${resolvedAssignmentId}/materials/${materialId}/convert-native-preview`,
        {},
      );
      setConvertPreview(data);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not parse document for conversion"));
      setConvertMaterialId(null);
    } finally {
      setConvertLoading(false);
    }
  }

  async function confirmConvert() {
    const id = assignmentId ?? (await resolveAssignmentId());
    if (!id || !convertMaterialId || !convertPreview) return;
    setConvertSaving(true);
    setError(null);
    try {
      const created = await apiClient.post<{
        material: SchoolMaterialDto;
        editUrl: string;
      }>(`/api/school/assignments/${id}/materials/${convertMaterialId}/convert-native`, {
        questions: convertPreview.questions,
      });
      setConvertMaterialId(null);
      setConvertPreview(null);
      router.push(created.editUrl || nativeTestEditUrl(id, created.material.id));
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create in-app test from document"));
    } finally {
      setConvertSaving(false);
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
                  <div className="flex flex-wrap items-center gap-2">
                    <AnchorButton
                      href={nativeTestEditUrl(assignmentId ?? "", m.id)}
                      size="sm"
                      variant="secondary"
                    >
                      {frozen ? "View test" : "Edit test"}
                    </AnchorButton>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Opens the full-page question builder
                      {assignmentPointsPossible != null
                        ? ` · assignment ${assignmentPointsPossible} pts`
                        : ""}
                    </p>
                  </div>
                ) : null}
                {canConvertMaterial(m) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={convertLoading && convertMaterialId === m.id}
                      onClick={() => void openConvert(m.id)}
                    >
                      Convert to in-app test
                    </Button>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Creates a new native test; keeps this original attached
                    </p>
                  </div>
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
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={creatingTest}
          onClick={() => void addNativeTest()}
        >
          Create in-app test
        </Button>
        {driveEnabled ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
            Add from Drive
          </Button>
        ) : null}
        <GooglePickerButton
          onBeforeOpen={async () => Boolean(await resolveAssignmentId())}
          onPicked={addGoogleMaterial}
          title="Attach Google file to assignment"
        />
        <GooglePickerButton
          onBeforeOpen={async () => Boolean(await resolveAssignmentId())}
          onPicked={(file) => addGoogleMaterial(file, true)}
          title="Import Google test into Domi Ops"
        >
          Import Google test
        </GooglePickerButton>
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

      <Modal
        open={Boolean(convertMaterialId)}
        onClose={() => {
          if (convertSaving) return;
          setConvertMaterialId(null);
          setConvertPreview(null);
        }}
        title="Convert to in-app test"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Parses the document into draft questions. The original file stays attached; you'll land
            in the editor to fix anything the parser flagged.
          </p>
          {convertLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Reading document…</p>
          ) : null}
          {convertPreview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{convertPreview.sourceMaterial.displayName}</span>
                {convertPreview.sourceMaterial.openUrl ? (
                  <a
                    href={convertPreview.sourceMaterial.openUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    Open original
                  </a>
                ) : null}
                <Badge tone="accent">{convertPreview.questionCount} questions</Badge>
              </div>
              {convertPreview.warnings.map((w) => (
                <Alert key={w} variant="info">
                  {w}
                </Alert>
              ))}
              <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                {convertPreview.questions.map((q, i) => (
                  <li
                    key={`${i}-${q.promptMarkdown.slice(0, 24)}`}
                    className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Q{i + 1}</span>
                      <Badge tone="default">{q.questionType.replaceAll("_", " ")}</Badge>
                      {q.needsReview ? <Badge tone="warning">Needs review</Badge> : null}
                      <span className="text-[var(--color-text-muted)]">{q.points} pts</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{q.promptMarkdown}</p>
                    {q.parseNotes.length > 0 ? (
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {q.parseNotes.join(" · ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={convertSaving}
              onClick={() => {
                setConvertMaterialId(null);
                setConvertPreview(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={convertSaving}
              disabled={!convertPreview || convertPreview.questionCount === 0}
              onClick={() => void confirmConvert()}
            >
              Create in-app test
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
