"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/client-api";
import { Badge } from "./ui";

export interface MemberKarma {
  memberId: string;
  label: string;
  karmaPoints: number;
  currentStreak: number;
  bestStreak: number;
  redemptionQuestsCompleted: number;
}

export function ChoreKarmaBar({ members }: { members: MemberKarma[] }) {
  const [karma, setKarma] = useState(members);

  useEffect(() => {
    setKarma(members);
  }, [members]);

  useEffect(() => {
    if (members.length > 0) return;
    void apiClient
      .get<{ members: MemberKarma[] }>("/api/core/chores/karma")
      .then((data) => setKarma(data.members))
      .catch(() => {});
  }, [members.length]);

  if (karma.length === 0) return null;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4"
      aria-label="Household Karma leaderboard"
    >
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
        <h2 className="text-sm font-semibold">Household Karma</h2>
      </div>
      <ul className="space-y-2">
        {karma.map((m) => (
          <li
            key={m.memberId}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="font-medium">{m.label}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{m.karmaPoints} karma</Badge>
              {m.currentStreak > 1 && (
                <Badge tone="default">{m.currentStreak}-day streak</Badge>
              )}
              {m.redemptionQuestsCompleted > 0 && (
                <Badge tone="warning">
                  {m.redemptionQuestsCompleted} redemption{m.redemptionQuestsCompleted === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
