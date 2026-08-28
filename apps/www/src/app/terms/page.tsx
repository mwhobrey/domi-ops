import {
  LegalArticleHeader,
  MarketingShell,
  resolveMarketingUrls,
  TermsOfServiceContent,
} from "@domi-ops/marketing-ui";

export const metadata = {
  title: "Terms of Service — Domi Ops",
};

// Reads NEXT_PUBLIC_* env vars at render time — see app/page.tsx for why this has to be forced
// dynamic or those values freeze at build time.
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <LegalArticleHeader title="Terms of Service" />
        <TermsOfServiceContent privacyHref="/privacy" />
      </article>
    </MarketingShell>
  );
}
