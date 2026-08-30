"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { HouseholdRole } from "../lib/household-roles";
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

function roleChangeErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.body) {
    try {
      const body = JSON.parse(err.body) as { message?: string; error?: string };
      if (body.message) return body.message;
      if (body.error === "last_owner") return "Cannot demote the last household owner.";
      if (body.error === "cannot_change_elevated") {
        return "Admins can only change member, child, or guest roles.";
      }
    } catch {
      /* */
    }
  }
  return err instanceof Error ? err.message : "Could not update role.";
}

const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  child: "Child (student)",
  guest: "Guest",
};

type MemberRow = {
  memberId: string;
  role: HouseholdRole;
  name: string | null;
  username: string | null;
  email: string | null;
};

function assignableRoles(actorRole: HouseholdRole, memberRole: HouseholdRole): HouseholdRole[] {
  if (actorRole === "owner") {
    return ["owner", "admin", "member", "child", "guest"];
  }
  if (actorRole === "admin" && memberRole !== "owner" && memberRole !== "admin") {
    return ["member", "child", "guest"];
  }
  return [];
}

export function HouseholdMembersPanel({
  canManage,
  actorRole,
}: {
  canManage: boolean;
  actorRole: HouseholdRole;
}) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"child" | "member" | "guest">("child");
  const [pending, setPending] = useState(false);
  const [usernameOk, setUsernameOk] = useState<boolean | null>(null);
  const [rolePendingId, setRolePendingId] = useState<string | null>(null);

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

  async function onRoleChange(memberId: string, nextRole: HouseholdRole) {
    setRolePendingId(memberId);
    setError(null);
    try {
      await apiClient.patch(`/api/core/household/members/${memberId}/role`, { role: nextRole });
      setMembers((prev) =>
        prev.map((m) => (m.memberId === memberId ? { ...m, role: nextRole } : m)),
      );
    } catch (err) {
      setError(roleChangeErrorMessage(err));
    } finally {
      setRolePendingId(null);
    }
  }

  if (!canManage) return null;

  return (
    <Card data-tour="invite-section">
      <CardBody className="space-y-6">
        <div className="space-y-1">
          <SectionHeader title="Members" />
          <p className="text-sm text-[var(--color-text-muted)]">
            Create username accounts for kids or other members who should not need email or Google.
            Adults with email can sign up or sign in with Google — single-tenant mode adds them to
            this household automatically.
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
            {members.map((m) => {
              const options = assignableRoles(actorRole, m.role);
              return (
                <li
                  key={m.memberId}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{m.name ?? "Member"}</p>
                    <p className="text-[var(--color-text-muted)]">
                      {m.username ? `@${m.username}` : m.email ?? "—"}
                    </p>
                  </div>
                  {options.length > 0 ? (
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Role for {m.name ?? "member"}</span>
                      <Select
                        value={m.role}
                        disabled={rolePendingId === m.memberId}
                        onChange={(e) => void onRoleChange(m.memberId, e.target.value as HouseholdRole)}
                        className="min-w-[9rem]"
                        aria-label={`Role for ${m.name ?? "member"}`}
                      >
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">{ROLE_LABELS[m.role]}</span>
                  )}
                </li>
              );
            })}
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
