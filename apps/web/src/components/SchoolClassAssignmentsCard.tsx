"use client";

import { Calendar, ClipboardList, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import {
  visibilityTone,
  formatDue,
  type Assignment,
  type AssignmentFilter,
  type AssignmentSort,
  type Category,
} from "../lib/school-class-types";
import { SchoolAssignmentSheet } from "./SchoolAssignmentSheet";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ListItem,
  SectionHeader,
  Select,
} from "./ui";

/** The "Assignments" card on a class detail page — list with filter/sort, create/edit/duplicate/
 *  delete. Owns its own assignments state (re-fetched fresh on mount, SSR data is just the
 *  first paint) so it stays independent of the class-meta and roster cards next to it. */
export function SchoolClassAssignmentsCard({
  classId,
  initialAssignments,
  categories,
  driveEnabled = false,
  canEditAssignments,
}: {
  classId: string;
  initialAssignments: Assignment[];
  categories: Category[];
  driveEnabled?: boolean;
  canEditAssignments: boolean;
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [assignmentSheetOpen, setAssignmentSheetOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [assignmentSort, setAssignmentSort] = useState<AssignmentSort>("due_asc");
  const [deleteTarget, setDeleteTarget] = useState<Assignment | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [duplicateLoadingId, setDuplicateLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiClient.get<{ assignments: Assignment[] }>(
          `/api/school/classes/${classId}/assignments`,
        );
        setAssignments(data.assignments);
      } catch {
        /* keep SSR data */
      }
    })();
  }, [classId]);

  const visibleAssignments = useMemo(() => {
    const now = Date.now();
    let list = [...assignments];
    switch (assignmentFilter) {
      case "assigned":
        list = list.filter((a) => a.visibility === "assigned");
        break;
      case "draft":
        list = list.filter((a) => a.visibility === "draft");
        break;
      case "closed":
        list = list.filter((a) => a.visibility === "closed");
        break;
      case "no_due":
        list = list.filter((a) => !a.dueAt);
        break;
      case "overdue":
        list = list.filter(
          (a) => a.dueAt && new Date(a.dueAt).getTime() < now && a.visibility !== "draft",
        );
        break;
      default:
        break;
    }
    return list.sort((a, b) => {
      switch (assignmentSort) {
        case "due_desc": {
          const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return db - da || a.title.localeCompare(b.title);
        }
        case "title_asc":
          return a.title.localeCompare(b.title);
        case "title_desc":
          return b.title.localeCompare(a.title);
        case "created_desc": {
          const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return cb - ca || a.title.localeCompare(b.title);
        }
        case "due_asc":
        default: {
          const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return da - db || a.title.localeCompare(b.title);
        }
      }
    });
  }, [assignments, assignmentFilter, assignmentSort]);

  async function confirmDeleteAssignment() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setError(null);
    try {
      await apiClient.delete(`/api/school/assignments/${deleteTarget.id}`);
      setAssignments((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete assignment");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function duplicateAssignment(assignment: Assignment) {
    setDuplicateLoadingId(assignment.id);
    setError(null);
    try {
      const data = await apiClient.post<{ assignment: Assignment }>(
        `/api/school/assignments/${assignment.id}/duplicate`,
        {},
      );
      setAssignments((prev) => [data.assignment, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to duplicate assignment");
    } finally {
      setDuplicateLoadingId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <SectionHeader
            title="Assignments"
            action={
              canEditAssignments ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setEditingAssignment(null);
                    setAssignmentSheetOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  New assignment
                </Button>
              ) : null
            }
          />
        </CardHeader>
        <CardBody>
          {error && <Alert variant="error">{error}</Alert>}
          {assignments.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Select
                className="min-w-[9rem]"
                value={assignmentFilter}
                aria-label="Filter assignments"
                onChange={(e) => setAssignmentFilter(e.target.value as AssignmentFilter)}
              >
                <option value="all">All</option>
                <option value="assigned">Assigned</option>
                <option value="draft">Draft</option>
                <option value="closed">Closed</option>
                <option value="no_due">No due date</option>
                <option value="overdue">Overdue</option>
              </Select>
              <Select
                className="min-w-[9rem]"
                value={assignmentSort}
                aria-label="Sort assignments"
                onChange={(e) => setAssignmentSort(e.target.value as AssignmentSort)}
              >
                <option value="due_asc">Due date (soonest)</option>
                <option value="due_desc">Due date (latest)</option>
                <option value="title_asc">Title A–Z</option>
                <option value="title_desc">Title Z–A</option>
                <option value="created_desc">Recently added</option>
              </Select>
            </div>
          )}
          {assignments.length === 0 ? (
            <EmptyState
              title="No assignments"
              description={
                canEditAssignments
                  ? "Create the first assignment for this class."
                  : "No assignments published yet."
              }
              icon={<ClipboardList className="h-10 w-10" aria-hidden />}
            />
          ) : visibleAssignments.length === 0 ? (
            <EmptyState
              title="No matching assignments"
              description="Try a different filter."
              icon={<ClipboardList className="h-10 w-10" aria-hidden />}
            />
          ) : (
            <ul className="space-y-2" aria-label="Assignments">
              {visibleAssignments.map((a) => (
                <li key={a.id}>
                  <ListItem as="div" className="hover:border-[var(--color-accent)]/40">
                    <Link
                      href={`/school/assignment/${a.id}`}
                      className="min-w-0 flex-1 rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
                    >
                      <p className="truncate font-medium text-[var(--color-accent)]">{a.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={visibilityTone[a.visibility] ?? "default"}>
                          {a.visibility}
                        </Badge>
                        {a.dueAt && (
                          <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                            <Calendar className="h-3 w-3" aria-hidden />
                            {formatDue(a.dueAt)}
                          </span>
                        )}
                        {a.pointsPossible != null && (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {a.pointsPossible} pts
                          </span>
                        )}
                      </div>
                    </Link>
                    {canEditAssignments ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={duplicateLoadingId === a.id}
                          onClick={() => void duplicateAssignment(a)}
                          aria-label={`Duplicate ${a.title}`}
                        >
                          <Copy className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingAssignment(a);
                            setAssignmentSheetOpen(true);
                          }}
                          aria-label={`Edit ${a.title}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(a)}
                          aria-label={`Delete ${a.title}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </ListItem>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete assignment?"
        message={
          deleteTarget
            ? `"${deleteTarget.title}" and all student submissions will be permanently deleted.`
            : ""
        }
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={() => void confirmDeleteAssignment()}
        onCancel={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
      />

      <SchoolAssignmentSheet
        open={assignmentSheetOpen}
        onClose={() => {
          setAssignmentSheetOpen(false);
          setEditingAssignment(null);
        }}
        classId={classId}
        assignment={editingAssignment}
        categories={categories}
        driveEnabled={driveEnabled}
        onSaved={(saved) => {
          setAssignments((prev) => {
            const idx = prev.findIndex((a) => a.id === saved.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...saved };
              return next;
            }
            return [saved, ...prev];
          });
        }}
      />
    </>
  );
}
