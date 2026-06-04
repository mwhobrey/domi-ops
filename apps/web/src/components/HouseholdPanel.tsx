"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { apiClient } from "../lib/client-api";
import {
  formatPresenceLine,
  type HomePresence,
  type HomeStatusView,
} from "../lib/home-status";
import { Alert, Avatar, Card, CardBody, CardHeader, Input, ListItem, SectionHeader } from "./ui";

export type StatusRow = {
  id: string;
  memberId: string | null;
  name: string;
  presence: HomePresence;
  statusMessage: string | null;
  avatarUrl: string | null;
};

export type SelfStatus = {
  homeStatusId: string;
  name: string;
  presence: HomePresence;
  statusMessage: string | null;
  avatarUrl: string | null;
};

function PresenceToggle({
  value,
  onChange,
  size = "sm",
}: {
  value: HomePresence;
  onChange: (presence: HomePresence) => void;
  size?: "sm" | "md";
}) {
  const options: HomePresence[] = ["Home", "Away"];
  return (
    <div
      className={cn(
        "flex gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-0.5",
        size === "md" && "p-1",
      )}
      role="group"
      aria-label="Home or away"
    >
      {options.map((presence) => (
        <button
          key={presence}
          type="button"
          aria-pressed={value === presence}
          className={cn(
            "rounded-md font-medium transition",
            size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs",
            value === presence
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40",
          )}
          onClick={() => onChange(presence)}
        >
          {presence}
        </button>
      ))}
    </div>
  );
}

export function HouseholdPanel({
  initial,
  self,
}: {
  initial: StatusRow[];
  self: SelfStatus | null;
}) {
  const [rows, setRows] = useState(initial);
  const [presence, setPresence] = useState<HomePresence>(self?.presence ?? "Away");
  const [statusMessage, setStatusMessage] = useState(self?.statusMessage ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!self) return;
    setPresence(self.presence);
    setStatusMessage(self.statusMessage ?? "");
  }, [self?.presence, self?.statusMessage, self?.homeStatusId]);

  const others = useMemo(() => {
    if (!self?.homeStatusId) return rows;
    return rows.filter((r) => r.id !== self.homeStatusId);
  }, [rows, self?.homeStatusId]);

  const selfView: HomeStatusView = { presence, statusMessage: statusMessage.trim() || null };

  async function patchHomeStatus(
    id: string,
    patch: { presence?: HomePresence; statusMessage?: string | null },
  ) {
    try {
      await apiClient.patch(`/api/core/dashboard/home-status/${id}`, patch);
      setError(null);
    } catch {
      setError("Failed to update status");
    }
  }

  function updateSelfRow(next: HomeStatusView) {
    if (!self?.homeStatusId) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === self.homeStatusId
          ? { ...r, presence: next.presence, statusMessage: next.statusMessage }
          : r,
      ),
    );
  }

  async function setSelfPresence(next: HomePresence) {
    if (!self?.homeStatusId) return;
    setPresence(next);
    const view = { presence: next, statusMessage: statusMessage.trim() || null };
    updateSelfRow(view);
    await patchHomeStatus(self.homeStatusId, {
      presence: next,
      statusMessage: view.statusMessage,
    });
  }

  async function saveStatusMessage(raw: string) {
    if (!self?.homeStatusId) return;
    const msg = raw.trim().slice(0, 64) || null;
    setStatusMessage(raw);
    const view = { presence, statusMessage: msg };
    updateSelfRow(view);
    await patchHomeStatus(self.homeStatusId, { statusMessage: msg });
  }

  async function setOtherPresence(id: string, next: HomePresence) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, presence: next, statusMessage: null } : r)),
    );
    await patchHomeStatus(id, { presence: next, statusMessage: null });
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <SectionHeader title="Household" />
      </CardHeader>
      <CardBody className="space-y-5">
        {error && (
          <Alert variant="error" className="mb-2">
            {error}
          </Alert>
        )}

        {self && (
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)]/40 p-4">
            <p className="text-label mb-3 text-[var(--color-text-muted)]">Your status</p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar
                  id={self.homeStatusId}
                  name={self.name}
                  src={self.avatarUrl}
                  size="lg"
                />
                <div>
                  <p className="font-medium">{self.name}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Showing:{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {formatPresenceLine(selfView)}
                    </span>
                  </p>
                </div>
              </div>
              <PresenceToggle value={presence} onChange={setSelfPresence} size="md" />
            </div>
            <div className="mt-4">
              <label htmlFor="status-message" className="text-label mb-1.5 block text-[var(--color-text-muted)]">
                Status message
              </label>
              <Input
                id="status-message"
                placeholder="e.g. At work, Grocery run, Back by 5"
                value={statusMessage}
                maxLength={64}
                onChange={(e) => setStatusMessage(e.target.value)}
                onBlur={() => saveStatusMessage(statusMessage)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Optional. Home or Away stays set; message saves when you leave the field.
              </p>
            </div>
          </div>
        )}

        {others.length === 0 && rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No members yet. Family members appear here after they sign in.
          </p>
        ) : others.length > 0 ? (
          <div>
            <p className="text-label mb-2 text-[var(--color-text-muted)]">Who&apos;s home</p>
            <ul className="space-y-2">
              {others.map((m) => (
                <ListItem key={m.id} as="li" className="flex-wrap justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      id={m.memberId ?? m.id}
                      name={m.name}
                      src={m.avatarUrl}
                    />
                    <div className="min-w-0">
                      <span className="truncate font-medium">{m.name}</span>
                      {m.statusMessage ? (
                        <p className="truncate text-xs text-[var(--color-text-muted)]">
                          {formatPresenceLine(m)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <PresenceToggle
                    value={m.presence}
                    onChange={(p) => setOtherPresence(m.id, p)}
                  />
                </ListItem>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
