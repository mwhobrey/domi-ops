import Link from "next/link";
import { LegalArticleHeader, TermsOfServiceContent } from "@domi-ops/marketing-ui";

export const metadata = {
  title: "Terms of Service — Domi Ops",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <LegalArticleHeader title="Terms of Service" />
      <TermsOfServiceContent privacyHref="/privacy" />
      <p className="mt-10 text-sm">
        <Link href="/login" className="text-[var(--color-accent)] underline hover:text-[var(--color-text)]">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
