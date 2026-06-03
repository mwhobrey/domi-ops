import Link from "next/link";
import { cookies } from "next/headers";
import { Card, CardBody } from "../components/ui";

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

async function hasSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  try {
    const base = process.env.API_URL ?? "http://localhost:4000";
    const res = await fetch(`${base}/auth/session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { authenticated?: boolean };
    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}

export default async function HomePage() {
  const health = await getHealth();
  const loggedIn = await hasSession();

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
            <Card key={card.title}>
              <CardBody>
                <h2 className="font-medium">{card.title}</h2>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">{card.desc}</p>
              </CardBody>
            </Card>
          ))}
        </section>

        <div className="flex flex-wrap gap-3">
          {loggedIn ? (
            <Link
              href="/dashboard"
              className="rounded-[var(--radius-lg)] bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-muted)]"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-[var(--radius-lg)] bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-muted)]"
            >
              Sign in
            </Link>
          )}
          {!loggedIn && (
            <Link
              href="/dashboard"
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-5 py-2.5 text-sm hover:bg-[var(--color-surface-elevated)]"
            >
              Dashboard
            </Link>
          )}
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
