"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Input, Select, Sheet, Textarea } from "./ui";

export interface AssignmentFormValues {
  title: string;
  instructionsHtml: string;
  dueAt: string;
  pointsPossible: string;
  visibility: "draft" | "assigned" | "closed";
  categoryId: string;
}

interface AssignmentRecord {
  id: string;
  title: string;
  dueAt: string | null;
  pointsPossible?: number;
  instructionsHtml?: string;
  visibility: string;
  categoryId?: string | null;
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
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SchoolAssignmentSheet({
  open,
  onClose,
  classId,
  assignment,
  categories = [],
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  assignment?: AssignmentRecord | null;
  categories?: CategoryOption[];
  onSaved: (assignment: AssignmentRecord) => void;
}) {
  const isEdit = Boolean(assignment);
  const [form, setForm] = useState<AssignmentFormValues>(() =>
    assignment
      ? {
          title: assignment.title,
          instructionsHtml: assignment.instructionsHtml ?? "",
          dueAt: toDatetimeLocal(assignment.dueAt),
          pointsPossible: String(assignment.pointsPossible ?? 100),
          visibility: (assignment.visibility as AssignmentFormValues["visibility"]) ?? "assigned",
          categoryId: assignment.categoryId ?? "",
        }
      : defaultForm,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm(next?: AssignmentRecord | null) {
    if (next) {
      setForm({
        title: next.title,
        instructionsHtml: next.instructionsHtml ?? "",
        dueAt: toDatetimeLocal(next.dueAt),
        pointsPossible: String(next.pointsPossible ?? 100),
        visibility: (next.visibility as AssignmentFormValues["visibility"]) ?? "assigned",
        categoryId: next.categoryId ?? "",
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
    };
    try {
      if (isEdit && assignment) {
        const data = await apiClient.patch<{ assignment: AssignmentRecord }>(
          `/api/school/assignments/${assignment.id}`,
          payload,
        );
        onSaved(data.assignment);
      } else {
        const data = await apiClient.post<{ assignment: AssignmentRecord }>(
          `/api/school/classes/${classId}/assignments`,
          payload,
        );
        onSaved(data.assignment);
      }
      resetForm();
      onClose();
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
        resetForm(assignment);
        onClose();
      }}
      title={isEdit ? "Edit assignment" : "New assignment"}
      description="Due date, points, instructions, and visibility."
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
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={saving}>
            {isEdit ? "Save changes" : "Create assignment"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              resetForm(assignment);
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
