import type { Database } from "@domi-ops/db";
import {
  chores,
  choresRecurring,
  type chores as choresTable,
  type choresRecurring as choresRecurringTable,
} from "@domi-ops/db";
import { and, eq, lte } from "drizzle-orm";
import {
  advanceRecurringDate,
  normalizeRecurringInterval,
  todayIsoDate,
  type RecurringInterval,
} from "./shopping.js";

export type ChorePriority = 0 | 1 | 2 | 3;

export const CHORE_PRIORITIES: ChorePriority[] = [0, 1, 2, 3];

const LIST_PREFIX = "list:";

export function normalizeChorePriority(raw: unknown): ChorePriority | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return null;
}

export function parseChoreTagsJson(raw: string | null | undefined): {
  list: string | null;
  tags: string[];
} {
  if (!raw) return { list: null, tags: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((t): t is string => typeof t === "string");
      const listEntry = strings.find((t) => t.startsWith(LIST_PREFIX));
      const list = listEntry ? listEntry.slice(LIST_PREFIX.length) : null;
      const tags = strings.filter((t) => !t.startsWith(LIST_PREFIX) && t.trim().length > 0);
      return { list, tags };
    }
  } catch {
    // ignore invalid JSON
  }
  return { list: null, tags: [] };
}

export function serializeChoreTagsJson(
  list: string | null | undefined,
  tags: string[] = [],
): string {
  const parts: string[] = [];
  if (list?.trim()) parts.push(`${LIST_PREFIX}${list.trim()}`);
  for (const t of tags) {
    const trimmed = t.trim();
    if (trimmed && !trimmed.startsWith(LIST_PREFIX)) parts.push(trimmed);
  }
  return JSON.stringify(parts);
}

export function serializeChore(row: typeof choresTable.$inferSelect) {
  const { list, tags } = parseChoreTagsJson(row.tagsJson);
  return {
    id: row.id,
    description: row.description,
    done: row.done,
    dueDate: row.dueDate ?? null,
    list,
    tags,
    priority: (row.priority ?? 0) as ChorePriority,
    assigneeMemberId: row.assigneeMemberId ?? null,
    recurringId: row.recurringId ?? null,
    createdByDisplayName: row.createdByDisplayName ?? null,
    createdAt: row.createdAt,
  };
}

export function serializeChoreRecurring(row: typeof choresRecurringTable.$inferSelect) {
  const { list, tags } = parseChoreTagsJson(row.tagsJson);
  return {
    id: row.id,
    description: row.description,
    list,
    tags,
    priority: (row.priority ?? 0) as ChorePriority,
    assigneeMemberId: row.assigneeMemberId ?? null,
    interval: row.interval as RecurringInterval,
    nextAt: row.nextAt,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export async function collectChoreListSuggestions(
  db: Database,
  householdId: string,
  q: string,
): Promise<string[]> {
  const rows = await db
    .select({ tagsJson: chores.tagsJson })
    .from(chores)
    .where(eq(chores.householdId, householdId));

  const recurringRows = await db
    .select({ tagsJson: choresRecurring.tagsJson })
    .from(choresRecurring)
    .where(eq(choresRecurring.householdId, householdId));

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const needle = q.trim().toLowerCase();

  for (const row of [...rows, ...recurringRows]) {
    const { list } = parseChoreTagsJson(row.tagsJson);
    if (!list?.trim()) continue;
    const name = list.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    seen.add(key);
    suggestions.push(name);
  }

  suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return suggestions.slice(0, 25);
}

export async function collectChoreTagSuggestions(
  db: Database,
  householdId: string,
  q: string,
): Promise<string[]> {
  const rows = await db
    .select({ tagsJson: chores.tagsJson })
    .from(chores)
    .where(eq(chores.householdId, householdId));

  const recurringRows = await db
    .select({ tagsJson: choresRecurring.tagsJson })
    .from(choresRecurring)
    .where(eq(choresRecurring.householdId, householdId));

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const needle = q.trim().toLowerCase();

  for (const row of [...rows, ...recurringRows]) {
    for (const tag of parseChoreTagsJson(row.tagsJson).tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      if (needle && !key.includes(needle)) continue;
      seen.add(key);
      suggestions.push(tag);
    }
  }

  suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return suggestions.slice(0, 25);
}

export type ChoreMakeRecurringBlockReason = "already_recurring" | "already_completed";

export function choreMakeRecurringBlockReason(chore: {
  recurringId: string | null;
  done: boolean;
}): ChoreMakeRecurringBlockReason | null {
  if (chore.recurringId) return "already_recurring";
  if (chore.done) return "already_completed";
  return null;
}

export function resolveRecurringAnchorDate(dueDate: string | null | undefined, today: string): string {
  const trimmed = dueDate?.trim();
  return trimmed || today;
}

export type PromoteChoreToRecurringInput = {
  interval: RecurringInterval;
  description?: string;
  list?: string | null;
  tags?: string[];
  priority?: ChorePriority;
  assigneeMemberId?: string | null;
  dueDate?: string | null;
};

export type PromoteChoreToRecurringResult =
  | {
      ok: true;
      chore: typeof choresTable.$inferSelect;
      recurring: typeof choresRecurringTable.$inferSelect;
    }
  | {
      ok: false;
      error: "not_found" | ChoreMakeRecurringBlockReason;
    };

export async function promoteChoreToRecurring(
  db: Database,
  householdId: string,
  choreId: string,
  input: PromoteChoreToRecurringInput,
): Promise<PromoteChoreToRecurringResult> {
  const [existing] = await db
    .select()
    .from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .limit(1);
  if (!existing) return { ok: false, error: "not_found" };

  const blockReason = choreMakeRecurringBlockReason(existing);
  if (blockReason) return { ok: false, error: blockReason };

  const description = input.description?.trim() || existing.description;
  let tagsJson = existing.tagsJson ?? serializeChoreTagsJson(null, []);
  if (input.list !== undefined || input.tags !== undefined) {
    const current = parseChoreTagsJson(existing.tagsJson);
    tagsJson = serializeChoreTagsJson(
      input.list !== undefined ? input.list : current.list,
      input.tags ?? current.tags,
    );
  }
  const priority = input.priority !== undefined ? input.priority : (existing.priority ?? 0);
  const assigneeMemberId =
    input.assigneeMemberId !== undefined ? input.assigneeMemberId : existing.assigneeMemberId;
  const dueDate =
    input.dueDate !== undefined
      ? input.dueDate?.trim() || null
      : existing.dueDate ?? null;
  const nextAt = resolveRecurringAnchorDate(dueDate, todayIsoDate());

  const [recurring] = await db
    .insert(choresRecurring)
    .values({
      householdId,
      description,
      tagsJson,
      priority,
      assigneeMemberId,
      interval: input.interval,
      nextAt,
    })
    .returning();

  const [chore] = await db
    .update(chores)
    .set({
      description,
      tagsJson,
      priority,
      assigneeMemberId,
      dueDate,
      recurringId: recurring.id,
    })
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .returning();

  return { ok: true, chore, recurring };
}

export async function materializeDueChoreRecurring(
  db: Database,
  householdId: string,
): Promise<number> {
  const today = todayIsoDate();
  const due = await db
    .select()
    .from(choresRecurring)
    .where(
      and(
        eq(choresRecurring.householdId, householdId),
        eq(choresRecurring.enabled, true),
        lte(choresRecurring.nextAt, today),
      ),
    );

  let created = 0;
  for (const template of due) {
    const [pending] = await db
      .select({ id: chores.id })
      .from(chores)
      .where(
        and(
          eq(chores.householdId, householdId),
          eq(chores.recurringId, template.id),
          eq(chores.done, false),
        ),
      )
      .limit(1);

    if (pending) {
      let nextAt = template.nextAt;
      while (nextAt <= today) {
        nextAt = advanceRecurringDate(template.interval as RecurringInterval, nextAt);
      }
      await db
        .update(choresRecurring)
        .set({ nextAt })
        .where(eq(choresRecurring.id, template.id));
      continue;
    }

    await db.insert(chores).values({
      householdId,
      description: template.description,
      tagsJson: template.tagsJson,
      priority: template.priority,
      assigneeMemberId: template.assigneeMemberId,
      dueDate: template.nextAt,
      recurringId: template.id,
    });

    const nextAt = advanceRecurringDate(template.interval as RecurringInterval, template.nextAt);
    await db
      .update(choresRecurring)
      .set({ nextAt })
      .where(eq(choresRecurring.id, template.id));
    created += 1;
  }

  return created;
}

export { normalizeRecurringInterval };
