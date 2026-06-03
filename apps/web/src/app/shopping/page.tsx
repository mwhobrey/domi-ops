import { AppShell } from "../../components/AppShell";
import { ShoppingList } from "../../components/ShoppingList";
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
      <ShoppingList initialItems={items} />
    </AppShell>
  );
}
