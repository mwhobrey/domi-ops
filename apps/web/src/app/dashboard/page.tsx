import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

export default async function DashboardPage() {
  let dashboard = { notice: "", whosHome: [] as { name: string; status: string }[] };
  try {
    dashboard = await apiFetch("/api/core/dashboard");
  } catch {
    /* empty */
  }

  return (
    <AppShell title="Dashboard">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Notice board
          </h2>
          <p className="whitespace-pre-wrap text-[var(--color-text)]">
            {dashboard.notice || "No notice yet."}
          </p>
        </section>
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Who&apos;s home
          </h2>
          <ul className="space-y-2">
            {dashboard.whosHome.length === 0 ? (
              <li className="text-sm text-[var(--color-text-muted)]">No status entries</li>
            ) : (
              dashboard.whosHome.map((m) => (
                <li
                  key={m.name}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)]/60 px-3 py-2"
                >
                  <span>{m.name}</span>
                  <span
                    className={`text-sm ${m.status === "Home" ? "text-emerald-400" : "text-[var(--color-text-muted)]"}`}
                  >
                    {m.status}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
