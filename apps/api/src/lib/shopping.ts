import type { Database } from "@whome/db";
import {
  shoppingItems,
  shoppingRecurring,
  shoppingTripItems,
  shoppingTrips,
  type shoppingItems as shoppingItemsTable,
  type shoppingRecurring as shoppingRecurringTable,
  type shoppingTrips as shoppingTripsTable,
} from "@whome/db";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

const AISLE_PREFIX = "aisle:";

export type RecurringInterval = "weekly" | "biweekly" | "monthly";

export const RECURRING_INTERVALS: RecurringInterval[] = ["weekly", "biweekly", "monthly"];

export function parseShoppingTagsJson(raw: string | null | undefined): {
  aisle: string | null;
  tags: string[];
} {
  if (!raw) return { aisle: null, tags: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((t): t is string => typeof t === "string");
      const aisleEntry = strings.find((t) => t.startsWith(AISLE_PREFIX));
      const aisle = aisleEntry ? aisleEntry.slice(AISLE_PREFIX.length) : null;
      const tags = strings.filter((t) => !t.startsWith(AISLE_PREFIX));
      return { aisle, tags };
    }
  } catch {
    // ignore invalid JSON
  }
  return { aisle: null, tags: [] };
}

export function serializeShoppingTagsJson(
  aisle: string | null | undefined,
  tags: string[] = [],
): string {
  const parts: string[] = [];
  if (aisle?.trim()) parts.push(`${AISLE_PREFIX}${aisle.trim()}`);
  for (const t of tags) {
    const trimmed = t.trim();
    if (trimmed && !trimmed.startsWith(AISLE_PREFIX)) parts.push(trimmed);
  }
  return JSON.stringify(parts);
}

export function serializeShoppingItem(row: typeof shoppingItemsTable.$inferSelect) {
  const { aisle, tags } = parseShoppingTagsJson(row.tagsJson);
  return {
    id: row.id,
    item: row.item,
    checked: row.checked,
    aisle,
    tags,
    quantity: row.quantity ?? null,
    unit: row.unit ?? null,
    notes: row.notes ?? null,
    cost: row.cost ?? null,
    recurringId: row.recurringId ?? null,
    createdAt: row.createdAt,
  };
}

export function serializeShoppingRecurring(row: typeof shoppingRecurringTable.$inferSelect) {
  const { aisle, tags } = parseShoppingTagsJson(row.tagsJson);
  return {
    id: row.id,
    item: row.item,
    aisle,
    tags,
    quantity: row.quantity ?? null,
    unit: row.unit ?? null,
    notes: row.notes ?? null,
    interval: row.interval as RecurringInterval,
    nextAt: row.nextAt,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export function serializeShoppingTrip(row: typeof shoppingTripsTable.$inferSelect) {
  return {
    id: row.id,
    clearedAt: row.clearedAt,
    tripTotal: row.tripTotal ?? null,
    hasReceipt: Boolean(row.receiptS3Key),
    expenseId: row.expenseId ?? null,
    itemCount: row.itemCount,
    createdByDisplayName: row.createdByDisplayName ?? null,
  };
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function advanceRecurringDate(interval: RecurringInterval, fromIso: string): string {
  const d = new Date(`${fromIso}T12:00:00.000Z`);
  if (interval === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (interval === "biweekly") {
    d.setUTCDate(d.getUTCDate() + 14);
  } else {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    if (d.getUTCDate() !== day) d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}

export function normalizeRecurringInterval(raw: string | undefined): RecurringInterval | null {
  if (raw === "weekly" || raw === "biweekly" || raw === "monthly") return raw;
  return null;
}

export function shoppingReceiptObjectKey(householdId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);
  return `households/${householdId}/shopping/receipts/${Date.now()}-${safe}`;
}

export function isReceiptKeyForHousehold(householdId: string, key: string): boolean {
  return key.startsWith(`households/${householdId}/shopping/receipts/`);
}

export async function collectAisleSuggestions(
  db: Database,
  householdId: string,
  q: string,
): Promise<string[]> {
  const rows = await db
    .select({ tagsJson: shoppingItems.tagsJson })
    .from(shoppingItems)
    .where(eq(shoppingItems.householdId, householdId));

  const recurringRows = await db
    .select({ tagsJson: shoppingRecurring.tagsJson })
    .from(shoppingRecurring)
    .where(eq(shoppingRecurring.householdId, householdId));

  const tripRows = await db
    .select({ tagsJson: shoppingTripItems.tagsJson })
    .from(shoppingTripItems)
    .innerJoin(shoppingTrips, eq(shoppingTripItems.tripId, shoppingTrips.id))
    .where(eq(shoppingTrips.householdId, householdId));

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const needle = q.trim().toLowerCase();

  for (const row of [...rows, ...recurringRows, ...tripRows]) {
    const { aisle } = parseShoppingTagsJson(row.tagsJson);
    if (!aisle?.trim()) continue;
    const name = aisle.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    seen.add(key);
    suggestions.push(name);
  }

  suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return suggestions.slice(0, 25);
}

export async function materializeDueRecurring(
  db: Database,
  householdId: string,
): Promise<number> {
  const today = todayIsoDate();
  const due = await db
    .select()
    .from(shoppingRecurring)
    .where(
      and(
        eq(shoppingRecurring.householdId, householdId),
        eq(shoppingRecurring.enabled, true),
        lte(shoppingRecurring.nextAt, today),
      ),
    );

  let created = 0;
  for (const template of due) {
    const [pending] = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.householdId, householdId),
          eq(shoppingItems.recurringId, template.id),
          eq(shoppingItems.checked, false),
        ),
      )
      .limit(1);

    if (pending) {
      let nextAt = template.nextAt;
      while (nextAt <= today) {
        nextAt = advanceRecurringDate(template.interval as RecurringInterval, nextAt);
      }
      await db
        .update(shoppingRecurring)
        .set({ nextAt })
        .where(eq(shoppingRecurring.id, template.id));
      continue;
    }

    await db.insert(shoppingItems).values({
      householdId,
      item: template.item,
      tagsJson: template.tagsJson,
      quantity: template.quantity,
      unit: template.unit,
      notes: template.notes,
      recurringId: template.id,
    });

    const nextAt = advanceRecurringDate(template.interval as RecurringInterval, template.nextAt);
    await db
      .update(shoppingRecurring)
      .set({ nextAt })
      .where(eq(shoppingRecurring.id, template.id));
    created += 1;
  }

  return created;
}

export async function buildShoppingReports(
  db: Database,
  householdId: string,
  from: string,
  to: string,
) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);

  const trips = await db
    .select()
    .from(shoppingTrips)
    .where(
      and(
        eq(shoppingTrips.householdId, householdId),
        gte(shoppingTrips.clearedAt, fromDate),
        lte(shoppingTrips.clearedAt, toDate),
      ),
    )
    .orderBy(shoppingTrips.clearedAt);

  const tripIds = trips.map((t) => t.id);
  let tripItemRows: (typeof shoppingTripItems.$inferSelect)[] = [];
  if (tripIds.length > 0) {
    tripItemRows = await db
      .select()
      .from(shoppingTripItems)
      .where(inArray(shoppingTripItems.tripId, tripIds));
  }

  const itemsByTrip = new Map<string, typeof tripItemRows>();
  for (const row of tripItemRows) {
    const bucket = itemsByTrip.get(row.tripId) ?? [];
    bucket.push(row);
    itemsByTrip.set(row.tripId, bucket);
  }

  let totalSpend = 0;
  const itemCounts = new Map<string, number>();
  const monthlyTotals = new Map<string, number>();

  for (const trip of trips) {
    const items = itemsByTrip.get(trip.id) ?? [];
    const itemCostSum = items.reduce((sum, i) => sum + (i.cost ?? 0), 0);
    const tripSpend = trip.tripTotal ?? (itemCostSum > 0 ? itemCostSum : 0);
    totalSpend += tripSpend;

    const monthKey = trip.clearedAt.toISOString().slice(0, 7);
    monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + tripSpend);

    for (const item of items) {
      const key = item.item.trim().toLowerCase();
      if (!key) continue;
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + 1);
    }
  }

  const topItems = [...itemCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => {
      const display =
        tripItemRows.find((r) => r.item.trim().toLowerCase() === key)?.item.trim() ?? key;
      return { item: display, count };
    });

  const monthly = [...monthlyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));

  return {
    from,
    to,
    totalSpend,
    tripCount: trips.length,
    topItems,
    monthlyTotals: monthly,
    trips: [...trips].reverse().map((t) => serializeShoppingTrip(t)),
  };
}
