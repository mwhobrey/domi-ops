import { MarketingShell, resolveMarketingUrls } from "@whome/marketing-ui";

export const metadata = {
  title: "Terms of Service — Domi Ops",
};

export default function TermsPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold">Terms of Service</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Placeholder — pre-launch</p>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
          <p>
            Full terms for Domi Ops cloud will be published before hosted signups open (
            <a href="https://linear.app/mikewhob-whome/issue/WHO-182">WHO-182</a>). Self-host
            operators remain responsible for their own instance and household data.
          </p>
          <p>
            For privacy practices, see{" "}
            <a href={urls.appPrivacy} className="text-[var(--color-accent)] underline">
              Privacy Policy
            </a>{" "}
            on the application site.
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
