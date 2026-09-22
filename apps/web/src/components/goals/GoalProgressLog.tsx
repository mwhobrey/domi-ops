"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { GoalDto, ProgressEventDto } from "../../lib/goals-types";
import { Alert, Button, Input } from "../ui";

/** Quick amount+note log form plus an expandable, undo-able history — mirrors health's
 *  dose-log/undo affordance (log now, fix mistakes later rather than editing in place). */
export function GoalProgressLog({
  goal,
  canManage,
  onUpdated,
}: {
  goal: GoalDto;
  canManage: boolean;
  onUpdated: (goal: GoalDto) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ProgressEventDto[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const data = await apiClient.get<{ events: ProgressEventDto[] }>(`/api/goals/${goal.id}/progress`);
      setHistory(data.events);
    } catch {
      setError("Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function logProgress() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed === 0) {
      setError("Enter a non-zero amount");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ goal: GoalDto }>(`/api/goals/${goal.id}/progress`, {
        amount: parsed,
        note: note.trim() || undefined,
      });
      onUpdated(data.goal);
      setAmount("");
      setNote("");
      if (historyOpen) void loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log progress");
    } finally {
      setLoading(false);
    }
  }

  async function undoEvent(eventId: string) {
    try {
      const data = await apiClient.delete<{ goal: GoalDto }>(`/api/goals/${goal.id}/progress/${eventId}`);
      onUpdated(data.goal);
      void loadHistory();
    } catch {
      setError("Could not undo that entry");
    }
  }

  if (!canManage) return null;

  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Input
          type="number"
          step="any"
          className="w-28"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Progress amount"
          disabled={loading}
        />
        <Input
          className="flex-1"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Progress note"
          disabled={loading}
        />
        <Button type="button" size="sm" loading={loading} onClick={() => void logProgress()}>
          Log progress
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          const next = !historyOpen;
          setHistoryOpen(next);
          if (next && !history) void loadHistory();
        }}
      >
        {historyOpen ? "Hide history" : "Show history"}
      </Button>
      {historyOpen ? (
        historyLoading ? (
          <p className="text-xs text-[var(--color-text-muted)]">Loading…</p>
        ) : (
          <ul className="space-y-1">
            {(history ?? []).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]"
              >
                <span>
                  {e.amount > 0 ? "+" : ""}
                  {e.amount} · {new Date(e.loggedAt).toLocaleString()}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void undoEvent(e.id)}>
                  Undo
                </Button>
              </li>
            ))}
            {(history ?? []).length === 0 ? (
              <li className="text-xs text-[var(--color-text-muted)]">No entries yet.</li>
            ) : null}
          </ul>
        )
      ) : null}
    </div>
  );
}
