import { LandingPage } from "@/components/LandingPage";

// This page reads NEXT_PUBLIC_* env vars at render time via resolveMarketingUrls() (inside
// LandingPage → MarketingShell) — without forcing dynamic rendering, Next has no dynamic API
// call to detect here, so it statically prerenders at build time and freezes whatever those
// vars were during CI, ignoring any change to the running container's .env afterward (confirmed
// live 2026-08-28: flipping NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED and recreating the container had
// zero effect until this was added).
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <LandingPage />;
}
