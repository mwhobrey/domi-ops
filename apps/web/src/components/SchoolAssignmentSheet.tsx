"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { SchoolAssignmentMaterialsEditor } from "./SchoolAssignmentMaterialsEditor";
import { Alert, Button, Checkbox, Input, Select, Sheet, Textarea } from "./ui";

export interface AssignmentFormValues {
  title: string;
  instructionsHtml: string;
  dueAt: string;
  pointsPossible: string;
  visibility: "draft" | "assigned" | "closed";
  categoryId: string;
  allowLate: boolean;
  maxAttemptsMode: "unlimited" | "1" | "2" | "3" | "custom";
  maxAttemptsCustom: string;
}

interface AssignmentRecord {
  id: string;
  title: string;
  dueAt: string | null;
  pointsPossible?: number;
  instructionsHtml?: string;
  visibility: string;
  categoryId?: string | null;
  allowLate?: boolean;
  maxAttempts?: number | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

const defaultForm: AssignmentFormValues = {
  title: "",
  instructionsHtml: "",
  dueAt: "",
  pointsPossible: "100",
  visibility: "assigned",
  categoryId: "",
  allowLate: true,
  maxAttemptsMode: "unlimited",
  maxAttemptsCustom: "",
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function maxAttemptsFromForm(form: AssignmentFormValues): number | null {
  if (form.maxAttemptsMode === "unlimited") return null;
  if (form.maxAttemptsMode === "custom") {
    const n = parseInt(form.maxAttemptsCustom, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return parseInt(form.maxAttemptsMode, 10);
}

function maxAttemptsToForm(maxAttempts?: number | null): Pick<AssignmentFormValues, "maxAttemptsMode" | "maxAttemptsCustom"> {
  if (maxAttempts == null) return { maxAttemptsMode: "unlimited", maxAttemptsCustom: "" };
  if (maxAttempts === 1) return { maxAttemptsMode: "1", maxAttemptsCustom: "" };
  if (maxAttempts === 2) return { maxAttemptsMode: "2", maxAttemptsCustom: "" };
  if (maxAttempts === 3) return { maxAttemptsMode: "3", maxAttemptsCustom: "" };
  return { maxAttemptsMode: "custom", maxAttemptsCustom: String(maxAttempts) };
}

export function SchoolAssignmentSheet({
  open,
  onClose,
  classId,
  assignment,
  categories = [],
  driveEnabled = false,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  assignment?: AssignmentRecord | null;
  categories?: CategoryOption[];
  driveEnabled?: boolean;
  onSaved: (assignment: AssignmentRecord) => void;
}) {
  const [savedAssignment, setSavedAssignment] = useState<AssignmentRecord | null>(assignment ?? null);
  const isEdit = Boolean(savedAssignment);
  const [form, setForm] = useState<AssignmentFormValues>(() =>
    assignment
      ? {
          title: assignment.title,
          instructionsHtml: assignment.instructionsHtml ?? "",
          dueAt: toDatetimeLocal(assignment.dueAt),
          pointsPossible: String(assignment.pointsPossible ?? 100),
          visibility: (assignment.visibility as AssignmentFormValues["visibility"]) ?? "assigned",
          categoryId: assignment.categoryId ?? "",
          allowLate: assignment.allowLate ?? true,
          ...maxAttemptsToForm(assignment.maxAttempts),
        }
      : defaultForm,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSavedAssignment(assignment ?? null);
      resetForm(assignment ?? null);
    }
  }, [open, assignment]);

  function resetForm(next?: AssignmentRecord | null) {
    if (next) {
      setForm({
        title: next.title,
        instructionsHtml: next.instructionsHtml ?? "",
        dueAt: toDatetimeLocal(next.dueAt),
        pointsPossible: String(next.pointsPossible ?? 100),
        visibility: (next.visibility as AssignmentFormValues["visibility"]) ?? "assigned",
        categoryId: next.categoryId ?? "",
        allowLate: next.allowLate ?? true,
        ...maxAttemptsToForm(next.maxAttempts),
      });
    } else {
      setForm(defaultForm);
    }
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      title: form.title.trim(),
      instructionsHtml: form.instructionsHtml,
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      pointsPossible: parseFloat(form.pointsPossible) || 100,
      visibility: form.visibility,
      categoryId: form.categoryId || null,
      allowLate: form.allowLate,
      maxAttempts: maxAttemptsFromForm(form),
    };
    try {
      if (isEdit && savedAssignment) {
        const data = await apiClient.patch<{ assignment: AssignmentRecord }>(
          `/api/school/assignments/${savedAssignment.id}`,
          payload,
        );
        setSavedAssignment(data.assignment);
        onSaved(data.assignment);
      } else {
        const data = await apiClient.post<{ assignment: AssignmentRecord }>(
          `/api/school/classes/${classId}/assignments`,
          payload,
        );
        setSavedAssignment(data.assignment);
        onSaved(data.assignment);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save assignment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        resetForm(assignment ?? null);
        setSavedAssignment(assignment ?? null);
        onClose();
      }}
      title={isEdit ? "Edit assignment" : "New assignment"}
      description="Due date, points, instructions, materials, and visibility."
    >
      <form className="space-y-4 px-6 pb-6" onSubmit={(e) => void handleSubmit(e)}>
        {error && <Alert variant="error">{error}</Alert>}
        <div>
          <label htmlFor="assignment-title" className="text-label text-[var(--color-text-muted)]">
            Title
          </label>
          <Input
            id="assignment-title"
            className="mt-1"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </div>
        <div>
          <label htmlFor="assignment-due" className="text-label text-[var(--color-text-muted)]">
            Due date <span className="font-normal">(optional)</span>
          </label>
          <Input
            id="assignment-due"
            type="datetime-local"
            className="mt-1"
            value={form.dueAt}
            onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="assignment-points" className="text-label text-[var(--color-text-muted)]">
              Points possible
            </label>
            <Input
              id="assignment-points"
              type="number"
              min={0}
              step={0.5}
              className="mt-1"
              value={form.pointsPossible}
              onChange={(e) => setForm((f) => ({ ...f, pointsPossible: e.target.value }))}
            />
          </div>
          <div>
            <label
              htmlFor="assignment-visibility"
              className="text-label text-[var(--color-text-muted)]"
            >
              Visibility
            </label>
            <Select
              id="assignment-visibility"
              className="mt-1 w-full"
              value={form.visibility}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  visibility: e.target.value as AssignmentFormValues["visibility"],
                }))
              }
            >
              <option value="draft">Draft</option>
              <option value="assigned">Assigned</option>
              <option value="closed">Closed</option>
            </Select>
          </div>
        </div>
        <div>
          <label htmlFor="assignment-max-attempts" className="text-label text-[var(--color-text-muted)]">
            Max attempts per student
          </label>
          <Select
            id="assignment-max-attempts"
            className="mt-1 w-full"
            value={form.maxAttemptsMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxAttemptsMode: e.target.value as AssignmentFormValues["maxAttemptsMode"],
              }))
            }
          >
            <option value="unlimited">Unlimited</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="custom">Custom</option>
          </Select>
          {form.maxAttemptsMode === "custom" ? (
            <Input
              className="mt-2"
              type="number"
              min={1}
              placeholder="Number of attempts"
              value={form.maxAttemptsCustom}
              onChange={(e) => setForm((f) => ({ ...f, maxAttemptsCustom: e.target.value }))}
              aria-label="Custom max attempts"
            />
          ) : null}
        </div>
        <Checkbox
          id="assignment-allow-late"
          label="Allow late submissions"
          checked={form.allowLate}
          onChange={(e) => setForm((f) => ({ ...f, allowLate: e.target.checked }))}
        />
        <p className="-mt-2 text-xs text-[var(--color-text-muted)]">
          When off, students cannot turn in work after the due date.
        </p>
        {categories.length > 0 && (
          <div>
            <label htmlFor="assignment-category" className="text-label text-[var(--color-text-muted)]">
              Category <span className="font-normal">(optional)</span>
            </label>
            <Select
              id="assignment-category"
              className="mt-1 w-full"
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            >
              <option value="">None</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <label
            htmlFor="assignment-instructions"
            className="text-label text-[var(--color-text-muted)]"
          >
            Instructions
          </label>
          <Textarea
            id="assignment-instructions"
            className="mt-1 min-h-[120px]"
            placeholder="What should students do?"
            value={form.instructionsHtml}
            onChange={(e) => setForm((f) => ({ ...f, instructionsHtml: e.target.value }))}
          />
        </div>

        {savedAssignment ? (
          <SchoolAssignmentMaterialsEditor
            assignmentId={savedAssignment.id}
            driveEnabled={driveEnabled}
            canEdit
          />
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            Save the assignment first to attach materials.
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={saving}>
            {isEdit ? "Save changes" : "Create assignment"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              resetForm(assignment ?? null);
              setSavedAssignment(assignment ?? null);
              onClose();
            }}
          >
            {savedAssignment && !assignment ? "Done" : "Cancel"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
