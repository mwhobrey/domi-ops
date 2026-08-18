import {
  LegalArticleHeader,
  MarketingShell,
  PrivacyPolicyContent,
  resolveMarketingUrls,
} from "@domi-ops/marketing-ui";

export const metadata = {
  title: "Privacy Policy — Domi Ops",
};

export default function PrivacyPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <LegalArticleHeader title="Privacy Policy" />
        <PrivacyPolicyContent termsHref="/terms" />
      </article>
    </MarketingShell>
  );
}
