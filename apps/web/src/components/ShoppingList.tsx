"use client";

import { useState } from "react";

interface ShoppingItem {
  id: string;
  item: string;
  checked: boolean;
}

export function ShoppingList({ initialItems }: { initialItems: ShoppingItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [newItem, setNewItem] = useState("");

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newItem.trim()) return;
          const res = await fetch("/api/core/shopping", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item: newItem.trim() }),
          });
          if (res.ok) {
            const data = (await res.json()) as { item: ShoppingItem };
            setItems((prev) => [...prev, data.item]);
            setNewItem("");
          }
        }}
      >
        <input
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm"
          placeholder="Add item…"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
        />
        <button
          type="submit"
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
        >
          Add
        </button>
      </form>
      <ul className="space-y-2">
        {items.length === 0 ? (
          <li className="text-[var(--color-text-muted)]">List is empty</li>
        ) : (
          items.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3"
            >
              <input
                type="checkbox"
                checked={i.checked}
                className="h-4 w-4"
                onChange={async () => {
                  const checked = !i.checked;
                  setItems((prev) =>
                    prev.map((x) => (x.id === i.id ? { ...x, checked } : x)),
                  );
                  await fetch(`/api/core/shopping/${i.id}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ checked }),
                  });
                }}
              />
              <span className={i.checked ? "line-through text-[var(--color-text-muted)]" : ""}>
                {i.item}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
