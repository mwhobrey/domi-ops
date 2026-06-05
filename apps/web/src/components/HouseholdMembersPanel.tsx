"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button } from "./ui";

function provisionErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.body) {
    try {
      const body = JSON.parse(err.body) as { message?: string };
      if (body.message) return body.message;
    } catch {
      /* */
    }
  }
  return err instanceof Error ? err.message : "Could not create member.";
}

type MemberRow = {
  memberId: string;
  role: string;
  name: string | null;
  nickname: string | null;
  username: string | null;
  email: string | null;
};

export function HouseholdMembersPanel({ canManage }: { canManage: boolean }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"child" | "member" | "guest">("child");
  const [pending, setPending] = useState(false);
  const [usernameOk, setUsernameOk] = useState<boolean | null>(null);

  const loadMembers = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ members: MemberRow[] }>("/api/core/household/members");
      setMembers(data.members);
    } catch {
      setError("Could not load household members.");
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!username.trim() || username.trim().length < 3) {
      setUsernameOk(null);
      return;
    }
    const timer = setTimeout(() => {
      void apiClient
        .get<{ available: boolean }>(
          `/api/core/household/usernames/available?username=${encodeURIComponent(username.trim())}`,
        )
        .then((res) => setUsernameOk(res.available))
        .catch(() => setUsernameOk(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [username]);

  async function onProvision(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiClient.post("/api/core/household/members/provision", {
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role,
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setUsernameOk(null);
      await loadMembers();
    } catch (err) {
      setError(provisionErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (!canManage) return null;

  return (
    <section className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 shadow-[var(--shadow-card)]">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Household members</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Create username accounts for kids or other members who should not need email or Google.
        </p>
      </div>

      {error && (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading members…</p>
      ) : members.length > 0 ? (
        <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          {members.map((m) => (
            <li key={m.memberId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{m.name ?? m.nickname ?? "Member"}</span>
              <span className="text-[var(--color-text-muted)]">
                {m.username ? `@${m.username}` : m.email ?? "—"} · {m.role}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">No members yet.</p>
      )}

      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onProvision}>
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-label text-[var(--color-text-muted)]">Username</span>
          <input
            required
            minLength={3}
            maxLength={30}
            pattern="[a-zA-Z0-9_.]+"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
          {usernameOk === true && (
            <span className="text-xs text-[var(--color-success)]">Available</span>
          )}
          {usernameOk === false && (
            <span className="text-xs text-[var(--color-danger)]">Taken or invalid</span>
          )}
        </label>
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-label text-[var(--color-text-muted)]">Display name</span>
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-label text-[var(--color-text-muted)]">Temporary password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-label text-[var(--color-text-muted)]">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <option value="child">Child (student)</option>
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending || usernameOk === false}>
            {pending ? "Creating…" : "Add username member"}
          </Button>
        </div>
      </form>
    </section>
  );
}
