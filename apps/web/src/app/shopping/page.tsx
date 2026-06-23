import { AppShell } from "../../components/AppShell";
import { ShoppingList } from "../../components/ShoppingList";
import { ModuleReportsLink } from "../../components/reports/ModuleReportsLink";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

interface ShoppingItem {
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

export default async function ShoppingPage() {
  let items: ShoppingItem[] = [];
  let recurring: Awaited<ReturnType<typeof loadRecurring>> = [];
  let loadError: string | null = null;
  try {
    const res = await apiFetch<{ items: ShoppingItem[] }>("/api/core/shopping");
    items = res.items;
    recurring = await loadRecurring();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load shopping list";
  }

  return (
    <AppShell
      title="Shopping list"
      actions={<ModuleReportsLink module="shopping" />}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/shopping">Retry</a>
        </Alert>
      ) : (
        <ShoppingList initialItems={items} initialRecurring={recurring} />
      )}
    </AppShell>
  );
}

async function loadRecurring() {
  try {
    const res = await apiFetch<{
      recurring: {
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
      }[];
    }>("/api/core/shopping/recurring");
    return res.recurring;
  } catch {
    return [];
  }
}
