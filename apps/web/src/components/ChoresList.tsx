"use client";

import { ClipboardList } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { ApiError, apiClient } from "../lib/client-api";
import { ChoreEditSheet } from "./ChoreEditSheet";
import { ChoreKarmaBar, type MemberKarma } from "./ChoreKarmaBar";
import { ModuleReportsLink } from "./reports/ModuleReportsLink";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  EmptyState,
  Input,
  LinkButton,
  ListItem,
  SectionHeader,
  Select,
} from "./ui";
import { ListPage } from "./lists/ListPage";
import { CollapsibleAddForm } from "./lists/CollapsibleAddForm";

export type ChorePriority = 0 | 1 | 2 | 3;

export interface Chore {
  id: string;
  description: string;
  done: boolean;
  dueDate: string | null;
  list: string | null;
  tags: string[];
  priority: ChorePriority;
  assigneeMemberId: string | null;
  recurringId: string | null;
}

export interface ChoreRecurring {
  id: string;
  description: string;
  list: string | null;
  tags: string[];
  priority: ChorePriority;
  assigneeMemberId: string | null;
  interval: "daily" | "weekly" | "biweekly" | "monthly";
  nextAt: string;
  enabled: boolean;
}

export interface HouseholdMemberOption {
  memberId: string;
  label: string;
}

type FilterMode = "all" | "open" | "overdue";

const NO_LIST_LABEL = "No list";
const ALL_LISTS = "";

const PRIORITY_OPTIONS = [
  { value: "0", label: "No priority" },
  { value: "1", label: "Low" },
  { value: "2", label: "Medium" },
  { value: "3", label: "High" },
] as const;

const INTERVAL_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
] as const;

interface ChoreCompletionFeedback {
  description: string;
  karmaEarned: number;
  timing: string;
  currentStreak: number;
}

function priorityLabel(priority: ChorePriority): string | null {
  const map: Record<ChorePriority, string | null> = {
    0: null,
    1: "Low",
    2: "Medium",
    3: "High",
  };
  return map[priority];
}

function priorityTone(priority: ChorePriority): "default" | "accent" | "warning" {
  if (priority >= 3) return "warning";
  if (priority >= 2) return "accent";
  return "default";
}

function isOverdue(dueDate: string | null, done: boolean): boolean {
  if (done || !dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function ChoreRow({
  chore: c,
  showList,
  editingDueId,
  setEditingDueId,
  patchChore,
  setEditChore,
  setDeleteId,
  memberLabel,
}: {
  chore: Chore;
  showList: boolean;
  editingDueId: string | null;
  setEditingDueId: (id: string | null) => void;
  patchChore: (id: string, patch: Partial<Chore>) => Promise<void>;
  setEditChore: (chore: Chore) => void;
  setDeleteId: (id: string) => void;
  memberLabel: (id: string | null) => string | null;
}) {
  const overdue = isOverdue(c.dueDate, c.done);
  const plabel = priorityLabel(c.priority);
  const assignee = memberLabel(c.assigneeMemberId);

  return (
    <ListItem
      as="li"
      className={cn(overdue && "border-[var(--color-danger)]/50")}
    >
      <Checkbox
        checked={c.done}
        onChange={async () => {
          const done = !c.done;
          await patchChore(c.id, { done });
        }}
        aria-label={`Mark ${c.description} as ${c.done ? "incomplete" : "done"}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <span className={c.done ? "line-through text-[var(--color-text-muted)]" : ""}>
          {c.description}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {showList && c.list ? <Badge tone="accent">{c.list}</Badge> : null}
          {c.dueDate && editingDueId !== c.id && (
            <button
              type="button"
              className={cn(
                "text-xs underline-offset-2 hover:underline",
                overdue ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]",
              )}
              onClick={() => setEditingDueId(c.id)}
              aria-label={`Edit due date for ${c.description}`}
            >
              Due {c.dueDate}
            </button>
          )}
          {editingDueId === c.id && (
            <Input
              type="date"
              className="h-8 w-auto text-xs"
              defaultValue={c.dueDate ?? ""}
              autoFocus
              aria-label={`Due date for ${c.description}`}
              onBlur={async (e) => {
                setEditingDueId(null);
                const next = e.target.value || null;
                if (next !== c.dueDate) {
                  await patchChore(c.id, { dueDate: next });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingDueId(null);
              }}
            />
          )}
          {!c.dueDate && editingDueId !== c.id && (
            <button
              type="button"
              className="text-xs text-[var(--color-text-muted)] hover:underline"
              onClick={() => setEditingDueId(c.id)}
            >
              Add due date
            </button>
          )}
          {plabel && <Badge tone={priorityTone(c.priority)}>{plabel}</Badge>}
          {assignee && <Badge tone="default">{assignee}</Badge>}
          {overdue && <Badge tone="warning">Redemption quest</Badge>}
          {c.recurringId && <Badge tone="accent">Recurring</Badge>}
        </div>
        {c.tags.length > 0 && (
          <div className="flex flex-wrap gap-1" role="list" aria-label="Tags">
            {c.tags.map((tag) => (
              <span key={tag} role="listitem">
                <Badge tone="default">{tag}</Badge>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="sm" onClick={() => setEditChore(c)}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDeleteId(c.id)}>
          Remove
        </Button>
      </div>
    </ListItem>
  );
}

function groupByList(items: Chore[]): { list: string; items: Chore[] }[] {
  const map = new Map<string, Chore[]>();
  for (const item of items) {
    const key = item.list?.trim() || NO_LIST_LABEL;
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === NO_LIST_LABEL) return 1;
      if (b === NO_LIST_LABEL) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .map(([list, groupItems]) => ({ list, items: groupItems }));
}

function ListFilterBar({
  lists,
  value,
  onChange,
}: {
  lists: string[];
  value: string;
  onChange: (list: string) => void;
}) {
  if (lists.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Filter by list"
    >
      <Button
        type="button"
        size="sm"
        variant={value === ALL_LISTS ? "primary" : "secondary"}
        aria-pressed={value === ALL_LISTS}
        onClick={() => onChange(ALL_LISTS)}
      >
        All lists
      </Button>
      {lists.map((list) => (
        <Button
          key={list}
          type="button"
          size="sm"
          variant={value === list ? "primary" : "secondary"}
          aria-pressed={value === list}
          onClick={() => onChange(list)}
        >
          {list}
        </Button>
      ))}
    </div>
  );
}

function FilterBar({
  value,
  onChange,
  counts,
}: {
  value: FilterMode;
  onChange: (mode: FilterMode) => void;
  counts: { all: number; open: number; overdue: number };
}) {
  const options: { mode: FilterMode; label: string; count: number }[] = [
    { mode: "all", label: "All", count: counts.all },
    { mode: "open", label: "Open", count: counts.open },
    { mode: "overdue", label: "Overdue", count: counts.overdue },
  ];

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Filter chores"
    >
      {options.map(({ mode, label, count }) => (
        <Button
          key={mode}
          type="button"
          size="sm"
          variant={value === mode ? "primary" : "secondary"}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {label}
          <span className="ml-1 tabular-nums text-[var(--color-text-muted)]">({count})</span>
        </Button>
      ))}
    </div>
  );
}

export function ChoresList({
  initialChores,
  initialRecurring = [],
  members = [],
  initialKarma = [],
}: {
  initialChores: Chore[];
  initialRecurring?: ChoreRecurring[];
  members?: HouseholdMemberOption[];
  initialKarma?: MemberKarma[];
}) {
  const [chores, setChores] = useState(initialChores);
  const [recurring, setRecurring] = useState(initialRecurring);
  const [filter, setFilter] = useState<FilterMode>("open");
  const [listFilter, setListFilter] = useState(ALL_LISTS);
  const [groupByListEnabled, setGroupByListEnabled] = useState(false);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [listName, setListName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [priority, setPriority] = useState<ChorePriority>(0);
  const [assigneeMemberId, setAssigneeMemberId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editChore, setEditChore] = useState<Chore | null>(null);
  const [editingDueId, setEditingDueId] = useState<string | null>(null);
  const [karmaFeedback, setKarmaFeedback] = useState<ChoreCompletionFeedback | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recDescription, setRecDescription] = useState("");
  const [recTags, setRecTags] = useState("");
  const [recPriority, setRecPriority] = useState<ChorePriority>(0);
  const [recAssignee, setRecAssignee] = useState("");
  const [recInterval, setRecInterval] = useState<ChoreRecurring["interval"]>("weekly");
  const [recLoading, setRecLoading] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [listSuggestions, setListSuggestions] = useState<string[]>([]);

  const memberLabel = useMemo(() => {
    const map = new Map(members.map((m) => [m.memberId, m.label]));
    return (id: string | null) => (id ? map.get(id) ?? "Member" : null);
  }, [members]);

  const fetchTagSuggestions = useCallback(async (query: string) => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/chores/tag-suggestions${params}`,
      );
      setTagSuggestions(data.suggestions);
    } catch {
      setTagSuggestions([]);
    }
  }, []);

  const fetchListSuggestions = useCallback(async (query: string) => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/chores/list-suggestions${params}`,
      );
      setListSuggestions(data.suggestions);
    } catch {
      setListSuggestions([]);
    }
  }, []);

  useEffect(() => {
    void fetchTagSuggestions("");
    void fetchListSuggestions("");
  }, [fetchTagSuggestions, fetchListSuggestions]);

  const listFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    let hasUnlisted = false;
    for (const c of chores) {
      const name = c.list?.trim();
      if (!name) {
        hasUnlisted = true;
        continue;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (hasUnlisted) names.push(NO_LIST_LABEL);
    return names;
  }, [chores]);

  const openCount = chores.filter((c) => !c.done).length;
  const overdueCount = chores.filter((c) => isOverdue(c.dueDate, c.done)).length;

  const visibleChores = useMemo(() => {
    let list = [...chores];
    if (filter === "open") list = list.filter((c) => !c.done);
    else if (filter === "overdue") list = list.filter((c) => isOverdue(c.dueDate, c.done));
    if (listFilter) {
      list = list.filter((c) => (c.list?.trim() || NO_LIST_LABEL) === listFilter);
    }
    list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const pr = b.priority - a.priority;
      if (pr !== 0) return pr;
      if (isOverdue(a.dueDate, a.done) !== isOverdue(b.dueDate, b.done)) {
        return isOverdue(a.dueDate, a.done) ? -1 : 1;
      }
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
    return list;
  }, [chores, filter, listFilter]);

  async function patchChore(id: string, patch: Partial<Chore>) {
    const prev = chores.find((x) => x.id === id);
    setChores((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const data = await apiClient.patch<{
        chore?: Chore;
        completion?: {
          karmaEarned: number;
          timing: string;
          currentStreak: number;
        };
      }>(`/api/core/chores/${id}`, patch);
      if (data.chore) {
        setChores((list) => list.map((x) => (x.id === id ? data.chore! : x)));
      }
      if (data.completion && prev) {
        setKarmaFeedback({
          description: prev.description,
          karmaEarned: data.completion.karmaEarned,
          timing: data.completion.timing,
          currentStreak: data.completion.currentStreak,
        });
      }
    } catch {
      if (prev) {
        setChores((list) => list.map((x) => (x.id === id ? prev : x)));
      }
      setError("Update failed");
    }
  }

  async function addChore(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ chore: Chore }>("/api/core/chores", {
        description: description.trim(),
        dueDate: dueDate || null,
        list: listName.trim() || null,
        tags: parseTagsInput(tagsInput),
        priority,
        assigneeMemberId: assigneeMemberId || null,
      });
      setChores((prev) => [data.chore, ...prev]);
      setDescription("");
      setDueDate("");
      setListName("");
      setTagsInput("");
      setPriority(0);
      setAssigneeMemberId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      setLoading(false);
    }
  }

  async function addRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!recDescription.trim()) return;
    setRecLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ recurring: ChoreRecurring }>(
        "/api/core/chores/recurring",
        {
          description: recDescription.trim(),
          tags: parseTagsInput(recTags),
          priority: recPriority,
          assigneeMemberId: recAssignee || null,
          interval: recInterval,
        },
      );
      setRecurring((prev) => [...prev, data.recurring]);
      setRecDescription("");
      setRecTags("");
      setRecPriority(0);
      setRecAssignee("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add recurring chore");
    } finally {
      setRecLoading(false);
    }
  }

  async function toggleRecurring(id: string, enabled: boolean) {
    setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    await apiClient.patch(`/api/core/chores/recurring/${id}`, { enabled }).catch(() => {
      setError("Could not update recurring chore");
    });
  }

  async function deleteRecurring(id: string) {
    setRecurring((prev) => prev.filter((r) => r.id !== id));
    await apiClient.delete(`/api/core/chores/recurring/${id}`).catch(() => {
      setError("Could not delete recurring chore");
    });
  }

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      toolbar={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterBar
              value={filter}
              onChange={setFilter}
              counts={{ all: chores.length, open: openCount, overdue: overdueCount }}
            />
            <div className="flex flex-wrap items-center gap-2">
              {listFilterOptions.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant={groupByListEnabled ? "secondary" : "ghost"}
                  aria-pressed={groupByListEnabled}
                  onClick={() => setGroupByListEnabled((v) => !v)}
                >
                  {groupByListEnabled ? "Ungroup" : "Group by list"}
                </Button>
              ) : null}
              <ModuleReportsLink module="chores" />
            </div>
          </div>
          <ListFilterBar lists={listFilterOptions} value={listFilter} onChange={setListFilter} />
        </div>
      }
      addForm={
        <CollapsibleAddForm label="Add chore">
        <form className="space-y-2" onSubmit={addChore}>
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1 basis-full sm:basis-auto"
              placeholder="New chore…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Due date"
            />
            <Select
              className="w-32"
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
                className="w-36"
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
            <Combobox
              className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-[8rem]"
              placeholder="List"
              value={listName}
              onChange={setListName}
              onQueryChange={fetchListSuggestions}
              suggestions={listSuggestions}
              aria-label="List"
            />
            <Button type="submit" loading={loading}>
              Add
            </Button>
          </div>
          <Input
            list="chore-tag-suggestions"
            placeholder="Tags (comma-separated)"
            value={tagsInput}
            onChange={(e) => {
              setTagsInput(e.target.value);
              void fetchTagSuggestions(e.target.value);
            }}
            aria-label="Tags"
          />
          <datalist id="chore-tag-suggestions">
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </form>
        </CollapsibleAddForm>
      }
    >
      <ChoreKarmaBar members={initialKarma} />

      {karmaFeedback ? (
        <div
          className="rounded-[var(--radius-lg)] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3 text-sm"
          role="status"
        >
          <p className="font-medium text-[var(--color-text)]">
            +{karmaFeedback.karmaEarned} Household Karma for &ldquo;{karmaFeedback.description}&rdquo;
          </p>
          <p className="mt-0.5 text-[var(--color-text-muted)]">
            {karmaFeedback.timing === "redemption"
              ? "Redemption quest complete — nice save!"
              : karmaFeedback.timing === "early"
                ? "Finished early — bonus karma!"
                : karmaFeedback.timing === "on_time"
                  ? "Right on time!"
                  : "Chore done!"}
            {karmaFeedback.currentStreak > 1
              ? ` ${karmaFeedback.currentStreak}-day streak.`
              : null}
          </p>
          <button
            type="button"
            className="mt-2 text-xs underline text-[var(--color-text-muted)]"
            onClick={() => setKarmaFeedback(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {visibleChores.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "No chores" : `No ${filter} chores`}
          description={filter === "all" ? "Add one above." : "Try another filter or add a chore."}
          icon={<ClipboardList className="h-10 w-10" />}
        />
      ) : groupByListEnabled ? (
        <div className="space-y-6">
          {groupByList(visibleChores).map(({ list, items: groupItems }) => (
            <section key={list}>
              <SectionHeader title={list} className="mb-2" />
              <ul className="space-y-2">
                {groupItems.map((c) => (
                  <ChoreRow
                    key={c.id}
                    chore={c}
                    showList={false}
                    editingDueId={editingDueId}
                    setEditingDueId={setEditingDueId}
                    patchChore={patchChore}
                    setEditChore={setEditChore}
                    setDeleteId={setDeleteId}
                    memberLabel={memberLabel}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleChores.map((c) => (
            <ChoreRow
              key={c.id}
              chore={c}
              showList
              editingDueId={editingDueId}
              setEditingDueId={setEditingDueId}
              patchChore={patchChore}
              setEditChore={setEditChore}
              setDeleteId={setDeleteId}
              memberLabel={memberLabel}
            />
          ))}
        </ul>
      )}

      <SectionHeader
        title="Recurring chores"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRecurringOpen((v) => !v)}
            aria-expanded={recurringOpen}
          >
            {recurringOpen ? "Hide" : "Manage"}
          </Button>
        }
      />
      {recurringOpen && (
        <div className="space-y-4">
          <form className="flex flex-wrap gap-2" onSubmit={addRecurring}>
            <Input
              className="min-w-0 flex-1 basis-full sm:basis-auto"
              placeholder="Recurring chore…"
              value={recDescription}
              onChange={(e) => setRecDescription(e.target.value)}
            />
            <Select
              className="w-36"
              value={recInterval}
              onChange={(e) => setRecInterval(e.target.value as ChoreRecurring["interval"])}
              aria-label="Repeat interval"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button type="submit" loading={recLoading} size="sm">
              Add template
            </Button>
          </form>
          {recurring.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No recurring templates yet.</p>
          ) : (
            <ul className="space-y-2">
              {recurring.map((r) => (
                <ListItem key={r.id} as="li">
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className={!r.enabled ? "text-[var(--color-text-muted)] line-through" : ""}>
                      {r.description}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="default">
                        {INTERVAL_OPTIONS.find((o) => o.value === r.interval)?.label ?? r.interval}
                      </Badge>
                      {priorityLabel(r.priority) && (
                        <Badge tone={priorityTone(r.priority)}>{priorityLabel(r.priority)}</Badge>
                      )}
                      {memberLabel(r.assigneeMemberId) && (
                        <Badge tone="default">{memberLabel(r.assigneeMemberId)}</Badge>
                      )}
                    </div>
                  </div>
                  <Checkbox
                    label="Enabled"
                    checked={r.enabled}
                    onChange={(e) => void toggleRecurring(r.id, e.target.checked)}
                  />
                  <Button variant="ghost" size="sm" onClick={() => void deleteRecurring(r.id)}>
                    Remove
                  </Button>
                </ListItem>
              ))}
            </ul>
          )}
        </div>
      )}

      <ChoreEditSheet
        chore={editChore}
        members={members}
        tagSuggestions={tagSuggestions}
        listSuggestions={listSuggestions}
        onTagQuery={(q) => void fetchTagSuggestions(q)}
        onListQuery={(q) => void fetchListSuggestions(q)}
        onClose={() => setEditChore(null)}
        onSaved={(updated) => {
          setChores((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        }}
        onMadeRecurring={(updated, template) => {
          setChores((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          setRecurring((prev) => [...prev, template]);
          setRecurringOpen(true);
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        title="Remove chore?"
        message="This cannot be undone."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          setChores((prev) => prev.filter((x) => x.id !== id));
          await apiClient.delete(`/api/core/chores/${id}`).catch(() => setError("Delete failed"));
        }}
        onCancel={() => setDeleteId(null)}
      />
    </ListPage>
  );
}
