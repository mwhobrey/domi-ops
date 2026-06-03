import { AppShell } from "../../components/AppShell";
import { ShoppingList } from "../../components/ShoppingList";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

interface ShoppingItem {
  id: string;
  item: string;
  checked: boolean;
}

export default async function ShoppingPage() {
  let items: ShoppingItem[] = [];
  let loadError: string | null = null;
  try {
    const res = await apiFetch<{ items: ShoppingItem[] }>("/api/core/shopping");
    items = res.items;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load shopping list";
  }

  return (
    <AppShell title="Shopping list" description="Shared household shopping">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/shopping">Retry</a>
        </Alert>
      ) : (
        <ShoppingList initialItems={items} />
      )}
    </AppShell>
  );
}
