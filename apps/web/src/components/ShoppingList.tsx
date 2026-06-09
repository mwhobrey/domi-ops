"use client";

import { ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { ApiError, apiClient } from "../lib/client-api";
import { ShoppingClearDialog } from "./ShoppingClearDialog";
import { ShoppingEditModal } from "./ShoppingEditModal";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  EmptyState,
  Input,
  ListItem,
  SectionHeader,
  Select,
  Textarea,
} from "./ui";
import { ListPage } from "./lists/ListPage";

export interface ShoppingItem {
  id: string;
  item: string;
  checked: boolean;
  aisle: string | null;
  tags: string[];
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  cost: number | null;
  recurringId: string | null;
}

export interface ShoppingRecurring {
  id: string;
  item: string;
  aisle: string | null;
  tags: string[];
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  interval: "weekly" | "biweekly" | "monthly";
  nextAt: string;
  enabled: boolean;
}

const UNIT_OPTIONS = ["each", "lb", "oz", "kg", "g", "gal", "L", "pack", "box"] as const;
const INTERVAL_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
] as const;

const NO_AISLE_LABEL = "No aisle";

function formatQuantity(quantity: number | null, unit: string | null): string | null {
  if (quantity == null && !unit) return null;
  if (quantity != null && unit) return `${quantity} ${unit}`;
  if (quantity != null) return String(quantity);
  return unit;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function groupByAisle(items: ShoppingItem[]): { aisle: string; items: ShoppingItem[] }[] {
  const map = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.aisle?.trim() || NO_AISLE_LABEL;
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === NO_AISLE_LABEL) return 1;
      if (b === NO_AISLE_LABEL) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .map(([aisle, groupItems]) => ({ aisle, items: groupItems }));
}

export function ShoppingList({
  initialItems,
  initialRecurring = [],
}: {
  initialItems: ShoppingItem[];
  initialRecurring?: ShoppingRecurring[];
}) {
  const [items, setItems] = useState(initialItems);
  const [recurring, setRecurring] = useState(initialRecurring);
  const [newItem, setNewItem] = useState("");
  const [newAisle, setNewAisle] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [aisleSuggestions, setAisleSuggestions] = useState<string[]>([]);
  const [groupByAisleEnabled, setGroupByAisleEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<ShoppingItem | null>(null);
  const [clearCheckedOpen, setClearCheckedOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recItem, setRecItem] = useState("");
  const [recAisle, setRecAisle] = useState("");
  const [recQty, setRecQty] = useState("");
  const [recUnit, setRecUnit] = useState("");
  const [recNotes, setRecNotes] = useState("");
  const [recInterval, setRecInterval] = useState<ShoppingRecurring["interval"]>("weekly");
  const [recLoading, setRecLoading] = useState(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/shopping/suggestions${params}`,
      );
      setSuggestions(data.suggestions);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const fetchAisleSuggestions = useCallback(async (query: string) => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/shopping/aisle-suggestions${params}`,
      );
      setAisleSuggestions(data.suggestions);
    } catch {
      setAisleSuggestions([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchSuggestions(newItem);
    }, 200);
    return () => clearTimeout(timer);
  }, [newItem, fetchSuggestions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAisleSuggestions(newAisle);
    }, 200);
    return () => clearTimeout(timer);
  }, [newAisle, fetchAisleSuggestions]);

  useEffect(() => {
    void fetchAisleSuggestions("");
  }, [fetchAisleSuggestions]);

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  const intervalLabel = useMemo(() => {
    const map = new Map(INTERVAL_OPTIONS.map((o) => [o.value, o.label]));
    return (value: ShoppingRecurring["interval"]) => map.get(value) ?? value;
  }, []);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.trim()) return;
    setLoading(true);
    setError(null);
    const quantity = newQuantity.trim() ? parseFloat(newQuantity) : null;
    try {
      const data = await apiClient.post<{ item: ShoppingItem }>("/api/core/shopping", {
        item: newItem.trim(),
        aisle: newAisle.trim() || null,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit: newUnit || null,
      });
      setItems((prev) => [...prev, data.item]);
      setNewItem("");
      setNewQuantity("");
      setNewUnit("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add item");
    } finally {
      setLoading(false);
    }
  }

  async function addRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!recItem.trim()) return;
    setRecLoading(true);
    setError(null);
    const quantity = recQty.trim() ? parseFloat(recQty) : null;
    try {
      const data = await apiClient.post<{ recurring: ShoppingRecurring }>(
        "/api/core/shopping/recurring",
        {
          item: recItem.trim(),
          aisle: recAisle.trim() || null,
          quantity: Number.isFinite(quantity) ? quantity : null,
          unit: recUnit || null,
          notes: recNotes.trim() || null,
          interval: recInterval,
        },
      );
      setRecurring((prev) => [...prev, data.recurring]);
      setRecItem("");
      setRecAisle("");
      setRecQty("");
      setRecUnit("");
      setRecNotes("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add recurring item");
    } finally {
      setRecLoading(false);
    }
  }

  async function toggleRecurring(id: string, enabled: boolean) {
    setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await apiClient.patch(`/api/core/shopping/recurring/${id}`, { enabled });
    } catch {
      setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)));
      setError("Failed to update recurring item");
    }
  }

  async function removeRecurring(id: string) {
    setRecurring((prev) => prev.filter((r) => r.id !== id));
    try {
      await apiClient.delete(`/api/core/shopping/recurring/${id}`);
    } catch {
      setError("Failed to delete recurring item");
    }
  }

  async function toggleItem(id: string, nextChecked: boolean) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, checked: nextChecked } : x)));
    try {
      await apiClient.patch(`/api/core/shopping/${id}`, { checked: nextChecked });
    } catch {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, checked: !nextChecked } : x)));
      setError("Failed to update item");
    }
  }

  async function removeItem(id: string) {
    setDeleteId(null);
    setItems((prev) => prev.filter((x) => x.id !== id));
    try {
      await apiClient.delete(`/api/core/shopping/${id}`);
    } catch {
      setError("Failed to delete item");
    }
  }

  function renderRow(i: ShoppingItem) {
    const qtyLabel = formatQuantity(i.quantity, i.unit);
    return (
      <ListItem
        key={i.id}
        as="li"
        className={cn(i.checked && "border-[var(--color-border)]/40 bg-[var(--color-surface-muted)]/50")}
      >
        <Checkbox
          checked={i.checked}
          onChange={() => toggleItem(i.id, !i.checked)}
          aria-label={`Mark ${i.item} as ${i.checked ? "not purchased" : "purchased"}`}
        />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "break-words",
              i.checked && "text-[var(--color-text-muted)] line-through",
            )}
          >
            {i.item}
          </span>
          {qtyLabel ? (
            <p className="text-xs text-[var(--color-text-muted)]">{qtyLabel}</p>
          ) : null}
          {i.notes ? (
            <p className="text-xs text-[var(--color-text-muted)]">{i.notes}</p>
          ) : null}
          {i.cost != null ? (
            <p className="text-xs text-[var(--color-text-muted)]">{formatMoney(i.cost)}</p>
          ) : null}
        </div>
        {i.aisle && !groupByAisleEnabled ? (
          <Badge tone="accent" className="hidden shrink-0 sm:inline-flex">
            {i.aisle}
          </Badge>
        ) : null}
        {i.recurringId ? (
          <Badge tone="default" className="hidden shrink-0 sm:inline-flex">
            Recurring
          </Badge>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditItem(i)}
            aria-label={`Edit ${i.item}`}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteId(i.id)}
            aria-label={`Remove ${i.item}`}
          >
            Remove
          </Button>
        </div>
      </ListItem>
    );
  }

  function renderUncheckedList() {
    if (groupByAisleEnabled) {
      return (
        <div className="space-y-4">
          {groupByAisle(unchecked).map(({ aisle, items: groupItems }) => (
            <section key={aisle}>
              <SectionHeader title={aisle} className="mb-2" />
              <ul className="space-y-2">{groupItems.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      );
    }
    return <ul className="space-y-2">{unchecked.map(renderRow)}</ul>;
  }

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        <div className="space-y-4">
          <form className="space-y-2" onSubmit={addItem}>
            <div className="flex flex-wrap gap-2">
              <Combobox
                className="min-w-0 flex-1 basis-full sm:basis-auto"
                placeholder="Add item…"
                value={newItem}
                onChange={setNewItem}
                suggestions={suggestions}
                aria-label="Shopping item"
              />
              <Input
                className="w-20"
                type="number"
                min={0}
                step="any"
                placeholder="Qty"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                aria-label="Quantity"
              />
              <Select
                className="w-24"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                aria-label="Unit"
              >
                <option value="">Unit</option>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
              <Combobox
                className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-[10rem]"
                placeholder="Aisle"
                value={newAisle}
                onChange={setNewAisle}
                onQueryChange={fetchAisleSuggestions}
                suggestions={aisleSuggestions}
                aria-label="Aisle"
              />
              <Button type="submit" loading={loading}>
                Add
              </Button>
            </div>
          </form>

          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={recurringOpen}
              onClick={() => setRecurringOpen((v) => !v)}
            >
              {recurringOpen ? "Hide recurring" : "Recurring items"}
            </Button>
            {recurringOpen ? (
              <div className="mt-3 space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                <form className="space-y-2" onSubmit={addRecurring}>
                  <div className="flex flex-wrap gap-2">
                    <Combobox
                      className="min-w-0 flex-1 basis-full sm:basis-auto"
                      placeholder="Recurring item…"
                      value={recItem}
                      onChange={setRecItem}
                      suggestions={suggestions}
                      aria-label="Recurring item name"
                    />
                    <Combobox
                      className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-[8rem]"
                      placeholder="Aisle"
                      value={recAisle}
                      onChange={setRecAisle}
                      onQueryChange={fetchAisleSuggestions}
                      suggestions={aisleSuggestions}
                      aria-label="Recurring aisle"
                    />
                    <Select
                      className="w-36"
                      value={recInterval}
                      onChange={(e) =>
                        setRecInterval(e.target.value as ShoppingRecurring["interval"])
                      }
                      aria-label="Repeat interval"
                    >
                      {INTERVAL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" loading={recLoading} size="sm">
                      Add recurring
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="w-20"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="Qty"
                      value={recQty}
                      onChange={(e) => setRecQty(e.target.value)}
                      aria-label="Recurring quantity"
                    />
                    <Select
                      className="w-24"
                      value={recUnit}
                      onChange={(e) => setRecUnit(e.target.value)}
                      aria-label="Recurring unit"
                    >
                      <option value="">Unit</option>
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                    <Textarea
                      className="min-w-0 flex-1 basis-full sm:basis-auto"
                      rows={1}
                      placeholder="Notes (optional)"
                      value={recNotes}
                      onChange={(e) => setRecNotes(e.target.value)}
                      aria-label="Recurring notes"
                    />
                  </div>
                </form>
                {recurring.length > 0 ? (
                  <ul className="space-y-2">
                    {recurring.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 font-medium">{r.item}</span>
                        <Badge tone="default">{intervalLabel(r.interval)}</Badge>
                        {r.aisle ? <Badge tone="accent">{r.aisle}</Badge> : null}
                        <label className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={r.enabled}
                            onChange={() => void toggleRecurring(r.id, !r.enabled)}
                            aria-label={`Enable ${r.item}`}
                          />
                          On
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void removeRecurring(r.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    No recurring items yet. Add weekly milk, monthly paper towels, etc.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          title="List is empty"
          description="Add your first item above."
          icon={<ShoppingCart className="h-10 w-10" />}
        />
      ) : (
        <div className="space-y-6">
          {unchecked.length > 0 && (
            <section>
              <SectionHeader
                title="To buy"
                className="mb-2"
                action={
                  <Button
                    type="button"
                    variant={groupByAisleEnabled ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={groupByAisleEnabled}
                    onClick={() => setGroupByAisleEnabled((v) => !v)}
                  >
                    {groupByAisleEnabled ? "Ungroup" : "Group by aisle"}
                  </Button>
                }
              />
              {renderUncheckedList()}
            </section>
          )}
          {checked.length > 0 && (
            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/50 p-3 sm:p-4">
              <SectionHeader
                title="In cart"
                className="mb-2"
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setClearCheckedOpen(true)}
                  >
                    Clear purchased ({checked.length})
                  </Button>
                }
              />
              <ul className="space-y-2">{checked.map(renderRow)}</ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Remove item?"
        message="This will delete the item from your list."
        confirmLabel="Remove"
        onConfirm={() => deleteId && removeItem(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      <ShoppingClearDialog
        open={clearCheckedOpen}
        items={checked}
        onClose={() => setClearCheckedOpen(false)}
        onCleared={() => {
          setItems((prev) => prev.filter((i) => !i.checked));
          void fetchSuggestions(newItem);
        }}
      />

      <ShoppingEditModal
        item={editItem}
        aisleSuggestions={aisleSuggestions}
        onAisleQuery={fetchAisleSuggestions}
        onClose={() => setEditItem(null)}
        onSaved={(updated) =>
          setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        }
      />
    </ListPage>
  );
}
