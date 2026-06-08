"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Combobox, Input, Select, Sheet } from "./ui";
import type {
  Chore,
  ChorePriority,
  ChoreRecurring,
  HouseholdMemberOption,
} from "./ChoresList";

const INTERVAL_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "0", label: "No priority" },
  { value: "1", label: "Low" },
  { value: "2", label: "Medium" },
  { value: "3", label: "High" },
] as const;

export function ChoreEditSheet({
  chore,
  members,
  tagSuggestions,
  listSuggestions,
  onTagQuery,
  onListQuery,
  onClose,
  onSaved,
  onMadeRecurring,
}: {
  chore: Chore | null;
  members: HouseholdMemberOption[];
  tagSuggestions: string[];
  listSuggestions: string[];
  onTagQuery: (query: string) => void;
  onListQuery: (query: string) => void;
  onClose: () => void;
  onSaved: (chore: Chore) => void;
  onMadeRecurring?: (chore: Chore, recurring: ChoreRecurring) => void;
}) {
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [listName, setListName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [priority, setPriority] = useState<ChorePriority>(0);
  const [assigneeMemberId, setAssigneeMemberId] = useState("");
  const [recurringInterval, setRecurringInterval] =
    useState<ChoreRecurring["interval"]>("weekly");
  const [loading, setLoading] = useState(false);
  const [makeRecurringLoading, setMakeRecurringLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chore) return;
    setDescription(chore.description);
    setDueDate(chore.dueDate ?? "");
    setListName(chore.list ?? "");
    setTagsInput(chore.tags.join(", "));
    setPriority(chore.priority);
    setAssigneeMemberId(chore.assigneeMemberId ?? "");
    setRecurringInterval("weekly");
    setError(null);
  }, [chore]);

  const canMakeRecurring = chore !== null && !chore.recurringId && !chore.done;

  function currentTags(): string[] {
    return tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function makeRecurring() {
    if (!chore || !description.trim() || !canMakeRecurring) return;
    setMakeRecurringLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ chore: Chore; recurring: ChoreRecurring }>(
        `/api/core/chores/${chore.id}/make-recurring`,
        {
          description: description.trim(),
          dueDate: dueDate || null,
          list: listName.trim() || null,
          tags: currentTags(),
          priority,
          assigneeMemberId: assigneeMemberId || null,
          interval: recurringInterval,
        },
      );
      onMadeRecurring?.(data.chore, data.recurring);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        let code: string | undefined;
        if (err.body) {
          try {
            const parsed = JSON.parse(err.body) as { error?: string };
            code = parsed.error;
          } catch {
            // ignore invalid JSON
          }
        }
        if (code === "already_recurring") {
          setError("This chore is already linked to a recurring template.");
        } else if (code === "already_completed") {
          setError("Completed chores cannot be made recurring.");
        } else if (code === "invalid_interval") {
          setError("Choose a valid repeat interval.");
        } else {
          setError("Failed to make recurring");
        }
      } else {
        setError("Failed to make recurring");
      }
    } finally {
      setMakeRecurringLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!chore || !description.trim()) return;
    setLoading(true);
    setError(null);
    const tags = currentTags();
    try {
      const data = await apiClient.patch<{ chore?: Chore }>(`/api/core/chores/${chore.id}`, {
        description: description.trim(),
        dueDate: dueDate || null,
        list: listName.trim() || null,
        tags,
        priority,
        assigneeMemberId: assigneeMemberId || null,
      });
      if (data.chore) onSaved(data.chore);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={chore !== null}
      onClose={onClose}
      title="Edit chore"
      description="Update title, list, due date, tags, priority, or assignee."
    >
      <form className="space-y-4 px-6 pb-6" onSubmit={(e) => void save(e)}>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Chore description"
          placeholder="Chore description"
          required
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due date"
        />
        <Combobox
          placeholder="List (optional)"
          value={listName}
          onChange={setListName}
          onQueryChange={onListQuery}
          suggestions={listSuggestions}
          aria-label="List"
        />
        <Input
          list="chore-edit-tag-suggestions"
          value={tagsInput}
          onChange={(e) => {
            setTagsInput(e.target.value);
            onTagQuery(e.target.value);
          }}
          aria-label="Tags"
          placeholder="Tags (comma-separated)"
        />
        <datalist id="chore-edit-tag-suggestions">
          {tagSuggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-36"
            value={String(priority)}
            onChange={(e) => setPriority(Number(e.target.value) as ChorePriority)}
            aria-label="Priority"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {members.length > 0 && (
            <Select
              className="min-w-[140px] flex-1"
              value={assigneeMemberId}
              onChange={(e) => setAssigneeMemberId(e.target.value)}
              aria-label="Assign to"
            >
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </div>
        {canMakeRecurring ? (
          <section
            className="space-y-2 border-t border-[var(--color-border)] pt-4"
            aria-labelledby="chore-make-recurring-heading"
          >
            <h3 id="chore-make-recurring-heading" className="text-sm font-medium">
              Make recurring
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Turn this chore into a repeating template. The due date anchors the first occurrence.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-40"
                value={recurringInterval}
                onChange={(e) =>
                  setRecurringInterval(e.target.value as ChoreRecurring["interval"])
                }
                aria-label="Repeat interval"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="secondary"
                loading={makeRecurringLoading}
                disabled={!description.trim()}
                onClick={() => void makeRecurring()}
              >
                Make recurring
              </Button>
            </div>
          </section>
        ) : chore?.recurringId ? (
          <p className="border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]">
            This chore is already part of a recurring series.
          </p>
        ) : chore?.done ? (
          <p className="border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]">
            Completed chores cannot be made recurring.
          </p>
        ) : null}
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={loading}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
