import { cookies } from "next/headers";
import { Card, CardBody, LinkButton } from "../components/ui";

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
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative mx-auto flex max-w-4xl flex-col gap-12 px-6 py-24">
        <header className="space-y-4">
          <p className="text-label text-[var(--color-text-muted)]">Household operations</p>
          <h1 className="font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            whome
          </h1>
          <p className="max-w-xl text-lg text-[var(--color-text-muted)]">
            Enterprise-grade home management. Calendar, homeschool, shopping, and the rest — private,
            self-hosted, open source.
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
            <LinkButton href="/dashboard" size="lg">
              Go to dashboard
            </LinkButton>
          ) : (
            <LinkButton href="/login" size="lg">
              Sign in
            </LinkButton>
          )}
          {!loggedIn && (
            <LinkButton href="/dashboard" variant="secondary" size="lg">
              Dashboard
            </LinkButton>
          )}
        </div>

        <footer className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <span
            className={`inline-block h-2 w-2 rounded-full ${health?.status === "ok" ? "bg-[var(--color-success)]" : "bg-[var(--color-warning)]"}`}
          />
          API {health?.status === "ok" ? "connected" : "starting or unreachable"}
        </footer>
      </div>
    </main>
  );
}
