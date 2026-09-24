"use client";

import { Repeat } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import {
  BILL_INTERVAL_OPTIONS,
  billDueLabel,
  billIntervalLabel,
  sortBills,
  upcomingBillsTotal,
  type BillInterval,
  type RecurringBill,
} from "../lib/bills";
import { formatDateLocal } from "../lib/calendar-utils";
import type { NoteShareMember } from "./NoteSharePicker";
import {
  Alert,
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  Input,
  ListItem,
  SectionHeader,
  Select,
  Sheet,
} from "./ui";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type BillDraft = {
  title: string;
  amount: string;
  category: string;
  interval: BillInterval;
  startDate: string;
  memberId: string;
};

function BillForm({
  initial,
  members,
  categorySuggestions,
  onCategoryQuery,
  submitLabel,
  onSubmit,
}: {
  initial: BillDraft;
  members: NoteShareMember[];
  categorySuggestions: string[];
  onCategoryQuery: (q: string) => void;
  submitLabel: string;
  onSubmit: (draft: BillDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof BillDraft>(key: K, value: BillDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const ok = await onSubmit(draft);
        setSaving(false);
        if (ok) setDraft(initial);
      }}
    >
      <Input
        placeholder="Bill (e.g. Rent)"
        value={draft.title}
        onChange={(e) => set("title", e.target.value)}
        aria-label="Bill name"
        required
      />
      <Input
        placeholder="$ Amount"
        inputMode="decimal"
        value={draft.amount}
        onChange={(e) => set("amount", e.target.value)}
        aria-label="Bill amount"
        required
      />
      <Combobox
        value={draft.category}
        onChange={(v) => set("category", v)}
        suggestions={categorySuggestions}
        onQueryChange={onCategoryQuery}
        placeholder="Category"
        aria-label="Bill category"
      />
      <Select
        aria-label="How often"
        value={draft.interval}
        onChange={(e) => set("interval", e.target.value as BillInterval)}
      >
        {BILL_INTERVAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <span className="shrink-0 text-[var(--color-text-muted)]">First due</span>
        <Input
          type="date"
          value={draft.startDate}
          onChange={(e) => set("startDate", e.target.value)}
          aria-label="First due date"
          required
        />
      </label>
      <Select
        aria-label="Paid by"
        value={draft.memberId}
        onChange={(e) => set("memberId", e.target.value)}
      >
        <option value="">Paid by: household</option>
        {members.map((m) => (
          <option key={m.memberId} value={m.memberId}>
            Paid by {m.label}
          </option>
        ))}
      </Select>
      <Button type="submit" loading={saving} className="sm:col-span-2 lg:col-span-1">
        {submitLabel}
      </Button>
    </form>
  );
}

export function RecurringBillsSection({
  members,
  currentMemberId,
  categorySuggestions,
  onCategoryQuery,
  onBillsPosted,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  categorySuggestions: string[];
  onCategoryQuery: (q: string) => void;
  /** A save can post a bill that's due today; the parent refreshes expenses and budgets. */
  onBillsPosted: () => void;
}) {
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringBill | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = formatDateLocal(new Date());

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<{ recurring: RecurringBill[] }>(
        "/api/core/expenses/recurring",
      );
      setBills(data.recurring);
    } catch {
      /* non-fatal: the section just stays empty */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => sortBills(bills), [bills]);
  const next30 = useMemo(() => upcomingBillsTotal(bills, today, 30), [bills, today]);

  const memberLabel = (id: string | null) =>
    id ? (members.find((m) => m.memberId === id)?.label ?? null) : null;

  function draftBody(draft: BillDraft) {
    return {
      title: draft.title.trim(),
      amount: parseFloat(draft.amount),
      category: draft.category.trim() || null,
      interval: draft.interval,
      startDate: draft.startDate,
      memberId: draft.memberId || null,
    };
  }

  async function save(draft: BillDraft, id?: string): Promise<boolean> {
    const body = draftBody(draft);
    if (!body.title || Number.isNaN(body.amount) || body.amount < 0) {
      setError("Give the bill a name and an amount.");
      return false;
    }
    setError(null);
    try {
      const data = id
        ? await apiClient.patch<{ recurring: RecurringBill }>(`/api/core/expenses/recurring/${id}`, body)
        : await apiClient.post<{ recurring: RecurringBill }>("/api/core/expenses/recurring", body);
      setBills((prev) =>
        id ? prev.map((b) => (b.id === id ? data.recurring : b)) : [...prev, data.recurring],
      );
      onBillsPosted();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the bill");
      return false;
    }
  }

  async function setEnabled(bill: RecurringBill, enabled: boolean) {
    try {
      const data = await apiClient.patch<{ recurring: RecurringBill }>(
        `/api/core/expenses/recurring/${bill.id}`,
        { enabled },
      );
      setBills((prev) => prev.map((b) => (b.id === bill.id ? data.recurring : b)));
      if (enabled) onBillsPosted();
    } catch {
      setError(enabled ? "Could not resume the bill" : "Could not pause the bill");
    }
  }

  const blankDraft: BillDraft = {
    title: "",
    amount: "",
    category: "",
    interval: "monthly",
    startDate: today,
    memberId: currentMemberId,
  };

  return (
    <section className="mb-6 space-y-3">
      <SectionHeader
        title="Recurring bills"
        action={
          <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add bill"}
          </Button>
        }
      />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {adding ? (
        <BillForm
          initial={blankDraft}
          members={members}
          categorySuggestions={categorySuggestions}
          onCategoryQuery={onCategoryQuery}
          submitLabel="Save bill"
          onSubmit={async (draft) => {
            const ok = await save(draft);
            if (ok) setAdding(false);
            return ok;
          }}
        />
      ) : null}
      {sorted.length === 0 && !adding ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Rent, subscriptions, insurance: add them once and they post to expenses on their due
          date, counting toward budgets.
        </p>
      ) : null}
      {sorted.length > 0 ? (
        <>
          {next30 > 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              {formatMoney(next30)} due in the next 30 days
            </p>
          ) : null}
          <ul className="space-y-2">
            {sorted.map((bill) => {
              const who = memberLabel(bill.memberId);
              return (
                <ListItem key={bill.id} as="li" className="flex flex-wrap items-center gap-3">
                  <Repeat className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{bill.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {billIntervalLabel(bill.interval)}
                      {" · "}
                      {bill.enabled ? billDueLabel(bill.nextAt, today) : "Paused"}
                      {bill.category ? ` · ${bill.category}` : ""}
                      {who ? ` · ${who}` : ""}
                    </p>
                  </div>
                  {!bill.enabled ? <Badge tone="default">Paused</Badge> : null}
                  <span className="font-semibold tabular-nums">{formatMoney(bill.amount)}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(bill)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void setEnabled(bill, !bill.enabled)}
                    >
                      {bill.enabled ? "Pause" : "Resume"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoveId(bill.id)}>
                      Remove
                    </Button>
                  </div>
                </ListItem>
              );
            })}
          </ul>
        </>
      ) : null}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Edit bill">
        {editing ? (
          <BillForm
            key={editing.id}
            initial={{
              title: editing.title,
              amount: String(editing.amount),
              category: editing.category ?? "",
              interval: editing.interval,
              startDate: editing.anchorDate,
              memberId: editing.memberId ?? "",
            }}
            members={members}
            categorySuggestions={categorySuggestions}
            onCategoryQuery={onCategoryQuery}
            submitLabel="Save"
            onSubmit={async (draft) => {
              const ok = await save(draft, editing.id);
              if (ok) setEditing(null);
              return ok;
            }}
          />
        ) : null}
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Changes apply to future bills. Expenses it already posted stay as they are.
        </p>
      </Sheet>

      <ConfirmDialog
        open={removeId !== null}
        title="Remove this bill?"
        message="Future bills stop posting. Expenses it already posted stay in your history."
        confirmLabel="Remove"
        onConfirm={async () => {
          const id = removeId;
          setRemoveId(null);
          if (!id) return;
          try {
            await apiClient.delete(`/api/core/expenses/recurring/${id}`);
            setBills((prev) => prev.filter((b) => b.id !== id));
          } catch {
            setError("Could not remove the bill");
          }
        }}
        onCancel={() => setRemoveId(null)}
      />
    </section>
  );
}
