"use client";

import { useState } from "react";

export function DashboardEditor({
  initialNotice,
  whosHome,
}: {
  initialNotice: string;
  whosHome: { id: string; name: string; status: string }[];
}) {
  const [notice, setNotice] = useState(initialNotice);
  const [statuses, setStatuses] = useState(whosHome);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Notice board
        </h2>
        <textarea
          className="mb-3 min-h-[120px] w-full rounded-lg border border-[var(--color-border)] bg-transparent p-3 text-sm"
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
          onClick={async () => {
            setMsg("Saving…");
            try {
              const res = await fetch("/api/core/dashboard/notice", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: notice }),
              });
              if (!res.ok) throw new Error(await res.text());
              setMsg("Saved");
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          Save notice
        </button>
        {msg && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{msg}</p>}
      </section>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Who&apos;s home
        </h2>
        <ul className="space-y-2">
          {statuses.length === 0 ? (
            <li className="text-sm text-[var(--color-text-muted)]">No status entries</li>
          ) : (
            statuses.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)]/60 px-3 py-2"
              >
                <span>{m.name}</span>
                <select
                  className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
                  value={m.status}
                  onChange={async (e) => {
                    const status = e.target.value;
                    setStatuses((prev) =>
                      prev.map((x) => (x.id === m.id ? { ...x, status } : x)),
                    );
                    await fetch(`/api/core/dashboard/home-status/${m.id}`, {
                      method: "PATCH",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status }),
                    });
                  }}
                >
                  <option value="Home">Home</option>
                  <option value="Away">Away</option>
                </select>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
