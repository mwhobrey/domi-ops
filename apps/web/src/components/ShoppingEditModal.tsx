"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button, Combobox, Input, Modal, Select, Textarea } from "./ui";
import type { ShoppingItem } from "./ShoppingList";

const UNIT_OPTIONS = ["each", "lb", "oz", "kg", "g", "gal", "L", "pack", "box"] as const;

export function ShoppingEditModal({
  item,
  aisleSuggestions,
  onAisleQuery,
  onClose,
  onSaved,
}: {
  item: ShoppingItem | null;
  aisleSuggestions: string[];
  onAisleQuery: (query: string) => void;
  onClose: () => void;
  onSaved: (item: ShoppingItem) => void;
}) {
  const [name, setName] = useState("");
  const [aisle, setAisle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setName(item.item);
    setAisle(item.aisle ?? "");
    setQuantity(item.quantity != null ? String(item.quantity) : "");
    setUnit(item.unit ?? "");
    setNotes(item.notes ?? "");
    setCost(item.cost != null ? String(item.cost) : "");
    setError(null);
  }, [item]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!item || !name.trim()) return;
    setLoading(true);
    setError(null);
    const parsedQty = quantity.trim() ? parseFloat(quantity) : null;
    const parsedCost = cost.trim() ? parseFloat(cost) : null;
    try {
      const data = await apiClient.patch<{ item: ShoppingItem }>(`/api/core/shopping/${item.id}`, {
        item: name.trim(),
        aisle: aisle.trim() || null,
        quantity: Number.isFinite(parsedQty) ? parsedQty : null,
        unit: unit || null,
        notes: notes.trim() || null,
        cost: Number.isFinite(parsedCost) ? parsedCost : null,
      });
      if (data.item) onSaved(data.item);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title="Edit item"
      description="Update name, aisle, quantity, notes, or cost."
      footer={
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="shopping-edit-form" loading={loading}>
            Save
          </Button>
        </div>
      }
    >
      <form id="shopping-edit-form" className="space-y-3" onSubmit={save}>
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Item name"
          placeholder="Item name"
          required
        />
        <Combobox
          value={aisle}
          onChange={setAisle}
          onQueryChange={onAisleQuery}
          suggestions={aisleSuggestions}
          placeholder="Aisle (optional)"
          aria-label="Aisle"
        />
        <div className="flex gap-2">
          <Input
            className="w-24"
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-label="Quantity"
            placeholder="Qty"
          />
          <Select
            className="w-28"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            aria-label="Unit"
          >
            <option value="">Unit</option>
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
          <Input
            className="flex-1"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            aria-label="Cost"
            placeholder="Cost ($)"
          />
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
          placeholder="Notes (optional)"
          rows={2}
        />
      </form>
    </Modal>
  );
}
