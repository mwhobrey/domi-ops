"use client";

import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { ApiError, apiClient } from "../lib/client-api";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Input,
  ListItem,
} from "./ui";
import { ListPage } from "./lists/ListPage";

interface Chore {
  id: string;
  description: string;
  done: boolean;
  dueDate: string | null;
}

function isOverdue(dueDate: string | null, done: boolean): boolean {
  if (done || !dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

export function ChoresList({ initialChores }: { initialChores: Chore[] }) {
  const [chores, setChores] = useState(initialChores);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function addChore(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ chore: Chore }>("/api/core/chores", {
        description: description.trim(),
        dueDate: dueDate || undefined,
      });
      setChores((prev) => [data.chore, ...prev]);
      setDescription("");
      setDueDate("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        <form className="flex flex-wrap gap-2" onSubmit={addChore}>
          <Input
            className="min-w-[200px] flex-1"
            placeholder="New chore…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Button type="submit" loading={loading}>
            Add
          </Button>
        </form>
      }
    >
      {chores.length === 0 ? (
        <EmptyState
          title="No chores"
          description="Add one above."
          icon={<ClipboardList className="h-10 w-10" />}
        />
      ) : (
        <ul className="space-y-2">
          {chores.map((c) => {
            const overdue = isOverdue(c.dueDate, c.done);
            return (
              <ListItem
                key={c.id}
                as="li"
                className={cn(overdue && "border-[var(--color-danger)]/50")}
              >
                <Checkbox
                  checked={c.done}
                  onChange={async () => {
                    const done = !c.done;
                    setChores((prev) => prev.map((x) => (x.id === c.id ? { ...x, done } : x)));
                    await apiClient.patch(`/api/core/chores/${c.id}`, { done });
                  }}
                  aria-label={`Mark ${c.description} as ${c.done ? "incomplete" : "done"}`}
                />
                <div className="flex-1">
                  <span className={c.done ? "line-through text-[var(--color-text-muted)]" : ""}>
                    {c.description}
                  </span>
                  {c.dueDate && (
                    <p
                      className={`text-xs ${overdue ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}
                    >
                      Due {c.dueDate}
                    </p>
                  )}
                </div>
                {overdue && (
                  <Badge tone="warning">Overdue</Badge>
                )}
                <Button variant="ghost" size="sm" onClick={() => setDeleteId(c.id)}>
                  Remove
                </Button>
              </ListItem>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={deleteId !== null}
        title="Remove chore?"
        message="This cannot be undone."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          setChores((prev) => prev.filter((x) => x.id !== id));
          await apiClient.delete(`/api/core/chores/${id}`).catch(() => setError("Delete failed"));
        }}
        onCancel={() => setDeleteId(null)}
      />
    </ListPage>
  );
}
