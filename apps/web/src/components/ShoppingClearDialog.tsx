"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button, Checkbox, Input, Modal } from "./ui";
import type { ShoppingItem } from "./ShoppingList";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function ShoppingClearDialog({
  open,
  items,
  onClose,
  onCleared,
}: {
  open: boolean;
  items: ShoppingItem[];
  onClose: () => void;
  onCleared: () => void;
}) {
  const [tripTotal, setTripTotal] = useState("");
  const [itemCosts, setItemCosts] = useState<Record<string, string>>({});
  const [createExpense, setCreateExpense] = useState(true);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const item of items) {
      initial[item.id] = item.cost != null ? String(item.cost) : "";
    }
    setItemCosts(initial);
    setTripTotal("");
    setCreateExpense(true);
    setReceiptFile(null);
    setError(null);
  }, [open, items]);

  const itemCostSum = useMemo(() => {
    return items.reduce((sum, item) => {
      const raw = itemCosts[item.id];
      const parsed = raw?.trim() ? parseFloat(raw) : NaN;
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }, [items, itemCosts]);

  const effectiveTotal = useMemo(() => {
    const parsedTrip = tripTotal.trim() ? parseFloat(tripTotal) : NaN;
    if (Number.isFinite(parsedTrip) && parsedTrip > 0) return parsedTrip;
    return itemCostSum > 0 ? itemCostSum : null;
  }, [tripTotal, itemCostSum]);

  async function uploadReceipt(): Promise<string | null> {
    if (!receiptFile) return null;
    try {
      const { uploadUrl, key } = await apiClient.post<{ uploadUrl: string; key: string }>(
        "/api/core/shopping/receipt/presign",
        {
          filename: receiptFile.name,
          contentType: receiptFile.type || "application/octet-stream",
        },
      );
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: receiptFile,
        headers: { "Content-Type": receiptFile.type || "application/octet-stream" },
      });
      if (!put.ok) throw new Error("upload_failed");
      return key;
    } catch {
      throw new Error("receipt_upload_failed");
    }
  }

  async function confirmClear() {
    setLoading(true);
    setError(null);
    try {
      let receiptKey: string | null = null;
      if (receiptFile) {
        receiptKey = await uploadReceipt();
      }

      const costs: Record<string, number> = {};
      for (const item of items) {
        const raw = itemCosts[item.id];
        const parsed = raw?.trim() ? parseFloat(raw) : NaN;
        if (Number.isFinite(parsed)) costs[item.id] = parsed;
      }

      await apiClient.post("/api/core/shopping/clear", {
        tripTotal: effectiveTotal,
        receiptKey,
        createExpense: createExpense && effectiveTotal != null && effectiveTotal > 0,
        itemCosts: costs,
      });
      onCleared();
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === "receipt_upload_failed") {
        setError("Receipt upload failed. Check storage settings or clear without a receipt.");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to clear purchased items");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clear purchased items"
      description={`Archive ${items.length} item${items.length === 1 ? "" : "s"} to trip history.`}
      panelClassName="max-w-xl"
      footer={
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" loading={loading} onClick={() => void confirmClear()}>
            Clear purchased
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="trip-total">
            Trip total (optional)
          </label>
          <Input
            id="trip-total"
            type="number"
            min={0}
            step="0.01"
            placeholder={itemCostSum > 0 ? formatMoney(itemCostSum) : "0.00"}
            value={tripTotal}
            onChange={(e) => setTripTotal(e.target.value)}
          />
          {effectiveTotal != null ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Recording {formatMoney(effectiveTotal)}
            </p>
          ) : null}
        </div>

        {items.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Per-item costs (optional)</p>
            <ul className="max-h-40 space-y-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)]/60 p-2">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-0.5">
                  <span className="min-w-0 flex-1 break-words text-sm">{item.item}</span>
                  <Input
                    className="w-28 shrink-0"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label={`Cost for ${item.item}`}
                    value={itemCosts[item.id] ?? ""}
                    onChange={(e) =>
                      setItemCosts((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={createExpense}
            onChange={() => setCreateExpense((v) => !v)}
            aria-label="Add groceries expense"
          />
          Add Groceries expense when total is set
        </label>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="receipt-file">
            Receipt photo (optional)
          </label>
          <Input
            id="receipt-file"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
          {receiptFile ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{receiptFile.name}</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
