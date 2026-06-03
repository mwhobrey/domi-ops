async function getHealth() {
  try {
    const base = process.env.API_URL ?? "http://localhost:4000";
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<{ status: string }>;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, #3b82f6 0%, transparent 50%), radial-gradient(ellipse 60% 40% at 100% 100%, #6366f1 0%, transparent 40%)",
        }}
      />
      <div className="relative mx-auto flex max-w-4xl flex-col gap-12 px-6 py-24">
        <header className="space-y-4">
          <p className="text-sm font-medium tracking-widest text-[var(--color-text-muted)] uppercase">
            Household operations
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            whome
          </h1>
          <p className="max-w-xl text-lg text-[var(--color-text-muted)]">
            Enterprise-grade home management. Calendar, homeschool, shopping, and
            the rest — private, self-hosted, open source.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "Calendar OS", desc: "Google import & sync — migrate off Google safely" },
            { title: "School", desc: "Homeschool LMS built in (v1 for your household)" },
            { title: "Import", desc: "whome-import from HomeHub SQLite" },
            { title: "Deploy", desc: "Docker on your DO droplet behind Caddy" },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]/80 p-6 backdrop-blur-sm"
            >
              <h2 className="font-medium">{card.title}</h2>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{card.desc}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap gap-3">
          <a
            href="/login"
            className="rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-muted)]"
          >
            Sign in
          </a>
          <a
            href="/dashboard"
            className="rounded-xl border border-[var(--color-border)] px-5 py-2.5 text-sm hover:bg-[var(--color-surface-elevated)]"
          >
            Dashboard
          </a>
        </div>

        <footer className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <span
            className={`inline-block h-2 w-2 rounded-full ${health?.status === "ok" ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          API {health?.status === "ok" ? "connected" : "starting or unreachable"}
        </footer>
      </div>
    </main>
  );
}
