import type { Metadata } from "next";
import { JoinHousehold } from "./JoinHousehold";
export const metadata: Metadata = { title: "Join your household | Domi Ops", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const params = await searchParams;
  return <JoinHousehold token={params.token} googleEnabled={Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)} oauthError={Boolean(params.error)} />;
}
