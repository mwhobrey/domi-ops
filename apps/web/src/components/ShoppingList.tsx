"use client";

import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button, Checkbox, ConfirmDialog, EmptyState, Input, ListItem, SectionHeader } from "./ui";
import { ListPage } from "./lists/ListPage";

interface ShoppingItem {
  id: string;
  item: string;
  checked: boolean;
}

export function ShoppingList({ initialItems }: { initialItems: ShoppingItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [newItem, setNewItem] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ item: ShoppingItem }>("/api/core/shopping", {
        item: newItem.trim(),
      });
      setItems((prev) => [...prev, data.item]);
      setNewItem("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add item");
    } finally {
      setLoading(false);
    }
  }

  async function toggleItem(id: string, checked: boolean) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, checked } : x)));
    try {
      await apiClient.patch(`/api/core/shopping/${id}`, { checked });
    } catch {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, checked: !checked } : x)));
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
    return (
      <ListItem key={i.id} as="li">
        <Checkbox
          checked={i.checked}
          onChange={() => toggleItem(i.id, !i.checked)}
          aria-label={`Mark ${i.item} as ${i.checked ? "not purchased" : "purchased"}`}
        />
        <span className={`flex-1 ${i.checked ? "text-[var(--color-text-muted)] line-through" : ""}`}>
          {i.item}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setDeleteId(i.id)}>
          Remove
        </Button>
      </ListItem>
    );
  }

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        <form className="flex gap-2" onSubmit={addItem}>
          <Input
            className="flex-1"
            placeholder="Add item…"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
          />
          <Button type="submit" loading={loading}>
            Add
          </Button>
        </form>
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
              <SectionHeader title="To buy" className="mb-2" />
              <ul className="space-y-2">{unchecked.map(renderRow)}</ul>
            </section>
          )}
          {checked.length > 0 && (
            <section>
              <SectionHeader title="In cart" className="mb-2" />
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
    </ListPage>
  );
}
