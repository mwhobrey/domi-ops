import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

/** Dogfood: skip marketing landing — redirect to app. Public marketing site is a later OSS release. */
export default async function HomePage() {
  if (await hasSession()) {
    redirect("/dashboard");
  }
  redirect("/login");
}
