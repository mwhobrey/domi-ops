"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button, Card, CardBody, Input, SectionHeader, Select } from "./ui";

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
    <Card>
      <CardBody className="space-y-6">
        <div className="space-y-1">
          <SectionHeader title="Members" />
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
              <li key={m.memberId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="font-medium">{m.name ?? "Member"}</span>
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
            <span className="text-sm font-medium">Username</span>
            <Input
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_.]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {usernameOk === true && (
              <span className="text-xs text-[var(--color-success)]">Available</span>
            )}
            {usernameOk === false && (
              <span className="text-xs text-[var(--color-danger)]">Taken or invalid</span>
            )}
          </label>
          <label className="block space-y-1.5 sm:col-span-1">
            <span className="text-sm font-medium">Display name</span>
            <Input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="block space-y-1.5 sm:col-span-1">
            <span className="text-sm font-medium">Temporary password</span>
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block space-y-1.5 sm:col-span-1">
            <span className="text-sm font-medium">Role</span>
            <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="child">Child (student)</option>
              <option value="member">Member</option>
              <option value="guest">Guest</option>
            </Select>
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || usernameOk === false}>
              {pending ? "Creating…" : "Add username member"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
