import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Domi Ops",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">Last updated: June 2026</p>

      <div className="prose prose-invert mt-8 max-w-none space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)] [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--color-text)]">
        <section>
          <h2>Overview</h2>
          <p>
            Domi Ops is self-hosted household software. Your operator (typically a family member who
            runs the server) controls the instance, data storage, and who may sign in. This policy
            describes what the application stores and how optional third-party services are used.
          </p>
        </section>

        <section>
          <h2>Information we store</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account identifiers (email, username, display name, profile photo)</li>
            <li>Household content you create (calendar events, lists, notes, expenses, school work, drive files, optional health records)</li>
            <li>Session and authentication tokens (HTTP-only cookies on your domain)</li>
            <li>Optional push notification subscription endpoints if you enable Web Push</li>
          </ul>
        </section>

        <section>
          <h2>Google sign-in and Calendar (optional)</h2>
          <p>
            If your operator enables Google OAuth, you may sign in with Google or connect Google
            Calendar. Google receives standard OAuth requests according to{" "}
            <a
              href="https://policies.google.com/privacy"
              className="text-[var(--color-accent)] underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google&apos;s Privacy Policy
            </a>
            . Calendar sync exchanges event data between your household database and Google Calendar
            when configured. OAuth tokens are encrypted at rest on your server.
          </p>
        </section>

        <section>
          <h2>Third-party services</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Weather</strong> — dashboard forecasts may call Open-Meteo using coordinates
              you provide; no account is required.
            </li>
            <li>
              <strong>Object storage</strong> — file uploads use S3-compatible storage configured by
              your operator (e.g. MinIO on the same server).
            </li>
            <li>
              <strong>Web Push</strong> — browser vendors (Google, Apple, Mozilla, etc.) deliver
              notifications when enabled; subscription keys are stored on your server.
            </li>
          </ul>
        </section>

        <section>
          <h2>Health module (optional)</h2>
          <p>
            If your operator enables the health module, members can log symptoms, appointments,
            and medications. Sensitive health fields (titles, notes, medication names, dosage, and
            instructions) are encrypted in the database using your server&apos;s{" "}
            <code className="text-xs">ENCRYPTION_KEY</code>. Metadata such as dates, member
            assignment, and schedule times remain queryable in plaintext. Health data is visible
            per record as household-wide or private with explicit shares (same pattern as notes).
            Domi Ops is household self-host software, not a healthcare provider — operators are
            responsible for HTTPS, disk encryption, and who may access the instance.
          </p>
        </section>

        <section>
          <h2>Data sharing</h2>
          <p>
            Household members with access to your instance can see household-visible content per
            module permissions. Private notes and drive objects are visible only to owners and
            members you explicitly share with. The Domi Ops project does not operate a central cloud
            database for self-hosted deployments.
          </p>
        </section>

        <section>
          <h2>Your choices</h2>
          <p>
            Contact your household operator to update profile data, revoke calendar connections, or
            request account removal. Operators can export or delete data by managing the PostgreSQL
            database and object storage directly.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For privacy questions about a specific Domi Ops instance, contact the person who administers
            your household server.
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm">
        <Link href="/login" className="text-[var(--color-accent)] underline hover:text-[var(--color-text)]">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
