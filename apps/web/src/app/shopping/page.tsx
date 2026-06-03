import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

interface ShoppingItem {
  id: string;
  item: string;
  checked: boolean;
}

export default async function ShoppingPage() {
  let items: ShoppingItem[] = [];
  try {
    const res = await apiFetch<{ items: ShoppingItem[] }>("/api/core/shopping");
    items = res.items;
  } catch {
    /* */
  }

  return (
    <AppShell title="Shopping list">
      <ul className="space-y-2">
        {items.length === 0 ? (
          <li className="text-[var(--color-text-muted)]">List is empty</li>
        ) : (
          items.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3"
            >
              <input type="checkbox" readOnly checked={i.checked} className="h-4 w-4" />
              <span className={i.checked ? "line-through text-[var(--color-text-muted)]" : ""}>
                {i.item}
              </span>
            </li>
          ))
        )}
      </ul>
    </AppShell>
  );
}
