"use client";

import { useState } from "react";
import { apiClient } from "../lib/client-api";
import { Alert, Button, Card, CardBody, CardHeader } from "./ui";

type StatusRow = { id: string; name: string; status: string };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function WhosHomePanel({ initial }: { initial: StatusRow[] }) {
  const [statuses, setStatuses] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    setStatuses((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));
    try {
      await apiClient.patch(`/api/core/dashboard/home-status/${id}`, { status });
    } catch {
      setError("Failed to update status");
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Who&apos;s home
        </h2>
      </CardHeader>
      <CardBody>
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}
        {statuses.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No members yet. Family members appear here after they sign in.
          </p>
        ) : (
          <ul className="space-y-3">
            {statuses.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)]/25 text-sm font-semibold">
                    {initials(m.name)}
                  </span>
                  <span className="font-medium">{m.name}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={m.status === "Home" ? "primary" : "secondary"}
                    onClick={() => setStatus(m.id, "Home")}
                  >
                    Home
                  </Button>
                  <Button
                    size="sm"
                    variant={m.status === "Away" ? "primary" : "secondary"}
                    onClick={() => setStatus(m.id, "Away")}
                  >
                    Away
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
