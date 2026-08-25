export const LEGAL_LAST_UPDATED = "August 25, 2026";
export const LEGAL_CONTACT_EMAIL = "privacy@domi-ops.com";

const bodyClass =
  "mt-8 space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)] [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--color-text)] [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:text-[var(--color-accent)] [&_a]:underline [&_code]:text-xs";

function Disclaimer() {
  return (
    <p className="mt-4 text-sm text-[var(--color-text-muted)]">
      Operator draft. This is not legal advice and has not been reviewed by a lawyer. The operator
      is a sole proprietor doing business as <strong className="text-[var(--color-text)]">Domi Ops</strong>{" "}
      (no limited liability company).
    </p>
  );
}

export function LegalArticleHeader({ title }: { title: string }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">Last updated: {LEGAL_LAST_UPDATED}</p>
      <Disclaimer />
    </>
  );
}

export function PrivacyPolicyContent({ termsHref }: { termsHref: string }) {
  return (
    <div className={bodyClass}>
      <section>
        <h2>Who is responsible</h2>
        <p>
          <strong className="text-[var(--color-text)]">Domi Ops Cloud</strong> (
          <code>domi-ops.com</code>, <code>app.domi-ops.com</code>, <code>demo.domi-ops.com</code>
          ): the sole proprietor doing business as Domi Ops is the data controller for accounts and
          household data stored on hosted infrastructure.
        </p>
        <p>
          <strong className="text-[var(--color-text)]">Self-hosted</strong> instances: the person or
          household who operates that server is the controller. Domi Ops (the project) does not
          operate a central database for self-hosted deployments and does not see that data.
        </p>
      </section>

      <section>
        <h2>Information stored</h2>
        <ul>
          <li>Account identifiers (email, username, display name, profile photo)</li>
          <li>
            Household content you create (calendar events, shopping and chores, notes, expenses,
            school work, Drive files, optional health records)
          </li>
          <li>Session and authentication cookies (HTTP-only on the app domain)</li>
          <li>Optional Web Push subscription endpoints if you enable notifications</li>
        </ul>
      </section>

      <section>
        <h2>Processors (when enabled)</h2>
        <ul>
          <li>
            <strong>Google</strong> — optional sign-in, Calendar sync, and Drive{" "}
            <code>drive.file</code> (Docs/Picker). See{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google&apos;s Privacy Policy
            </a>
            . OAuth tokens are encrypted at rest on the instance.
          </li>
          <li>
            <strong>Object storage</strong> — S3-compatible storage (MinIO or a cloud bucket) for
            uploads.
          </li>
          <li>
            <strong>Email</strong> — SMTP you or the hosted operator configure (verification and
            transactional mail).
          </li>
          <li>
            <strong>Weather</strong> — Open-Meteo using coordinates you provide; no weather account
            is required.
          </li>
          <li>
            <strong>Web Push</strong> — browser vendors deliver notifications; subscription keys
            stay on the instance.
          </li>
          <li>
            <strong>Stripe</strong> — billing, trials, and invoices when hosted checkout is live.
            Card details are handled by Stripe, not stored in Domi Ops.
          </li>
        </ul>
      </section>

      <section>
        <h2>Health module</h2>
        <p>
          Optional. Sensitive fields (titles, notes, medication names, dosage, instructions) are
          encrypted at rest with the instance <code>ENCRYPTION_KEY</code>. Dates, member assignment,
          and schedule times remain queryable. Access follows per-record visibility and segment ACL
          — there is <strong className="text-[var(--color-text)]">no admin override</strong> of
          private health data. Domi Ops is not a healthcare provider and is{" "}
          <strong className="text-[var(--color-text)]">not HIPAA-compliant</strong>.
        </p>
      </section>

      <section>
        <h2>School module</h2>
        <p>
          Homeschool and family coursework only. Domi Ops is{" "}
          <strong className="text-[var(--color-text)]">not a school of record</strong>, not an
          accredited institution, and does not issue official transcripts to third parties.
        </p>
      </section>

      <section>
        <h2>Children and household accounts</h2>
        <p>
          Households may provision child or student accounts (including username-only members). A
          parent or guardian who owns or administers the household is responsible for those
          accounts and for deciding what data is stored.
        </p>
      </section>

      <section>
        <h2>Sharing inside a household</h2>
        <p>
          Members see household-visible content per module permissions. Private notes, Drive
          objects, and health records are limited to owners and people you explicitly share with
          (or grant ACL access).
        </p>
      </section>

      <section>
        <h2>Optional anonymized metrics</h2>
        <p>
          Off by default on every household, self-hosted or Cloud. An owner or admin can turn it on
          in <strong className="text-[var(--color-text)]">Settings → Privacy</strong>. When on, we
          collect:
        </p>
        <ul>
          <li>Technical health — page load speed, JavaScript errors, API response times</li>
          <li>
            Feature usage — which modules and actions get used (e.g. &quot;a chore was
            completed&quot;), never the content of what you created
          </li>
        </ul>
        <p>
          These events carry a randomly generated id stored in your browser — not your account,
          household, name, or email — and nothing in our metrics storage links back to household
          data. Turning it off stops collection immediately; turning it on later starts a new random
          id, not a resumed history.{" "}
          <strong className="text-[var(--color-text)]">
            We do not sell this data, or any data, to anyone, ever
          </strong>{" "}
          — it is used only to find bugs and decide what to build next.
        </p>
        <p>
          Separately, anyone can send a bug report or feedback from their Profile page at any time,
          regardless of this setting — that message (and an optional reply email, if you choose to
          leave one) is sent because you chose to send it, not collected passively.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          <strong className="text-[var(--color-text)]">Cloud:</strong> email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> to update profile
          data, revoke Google connections, or request account and household deletion. We will
          delete or anonymize hosted records within a reasonable time unless we must retain them
          for legal or billing disputes.
        </p>
        <p>
          <strong className="text-[var(--color-text)]">Self-host:</strong> the instance operator
          exports or deletes data by managing PostgreSQL and object storage directly.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can disconnect Google Calendar or Docs, disable Web Push, turn off optional modules
          (within what the instance enables), and turn anonymized metrics on or off — all in
          household settings. See also the <a href={termsHref}>Terms of Service</a>.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Cloud privacy questions:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>. For a self-hosted
          instance, contact the person who administers that server.
        </p>
      </section>
    </div>
  );
}

export function TermsOfServiceContent({ privacyHref }: { privacyHref: string }) {
  return (
    <div className={bodyClass}>
      <section>
        <h2>Agreement</h2>
        <p>
          These terms govern use of Domi Ops software and, if you subscribe, Domi Ops Cloud. By
          creating an account, paying for hosted service, or running the software, you agree to
          them. Privacy practices are described in the{" "}
          <a href={privacyHref}>Privacy Policy</a>.
        </p>
      </section>

      <section>
        <h2>Two ways to run Domi Ops</h2>
        <ul>
          <li>
            <strong className="text-[var(--color-text)]">Self-host (OSS):</strong> you operate the
            instance. You are responsible for security, backups, who may sign in, and all data on
            that server. The MIT license applies to the software.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Domi Ops Cloud:</strong> we host the
            application for your household on shared infrastructure (Starter tier). You remain
            responsible for how household members use the product and for content they store.
          </li>
        </ul>
      </section>

      <section>
        <h2>Accounts</h2>
        <p>
          You must provide accurate account details and keep credentials confidential. Household
          owners and admins may provision additional members, including children. You are
          responsible for activity under those accounts.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>Do not use Domi Ops to:</p>
        <ul>
          <li>Break the law, or store or share content you do not have the right to use</li>
          <li>Attack, scrape, or disrupt the hosted service or other households</li>
          <li>Attempt to access another household&apos;s data</li>
          <li>Upload malware or abuse public Drive share links</li>
        </ul>
        <p>We may suspend hosted access for abuse, non-payment, or legal risk.</p>
      </section>

      <section>
        <h2>Payments and trial (Cloud)</h2>
        <p>
          Hosted Starter is currently <strong className="text-[var(--color-text)]">$12/month</strong>{" "}
          or <strong className="text-[var(--color-text)]">$120/year</strong>, with a 14-day trial
          that requires a card. Prices may change with notice. Checkout may not be open yet; these
          terms still describe the intended hosted offering. Failed payment or cancellation ends
          hosted access after any remaining paid period. Self-host remains free under MIT.
        </p>
      </section>

      <section>
        <h2>Service level</h2>
        <p>
          Cloud is provided as-is. There is{" "}
          <strong className="text-[var(--color-text)]">no uptime SLA</strong> in this version. We
          will try to keep the service available and to back up hosted data, but we do not
          guarantee uninterrupted access or that restores will be instant.
        </p>
      </section>

      <section>
        <h2>Termination</h2>
        <p>
          You may stop using Cloud by canceling the subscription (when billing is live) and
          requesting deletion via {LEGAL_CONTACT_EMAIL}. We may terminate hosted accounts for
          breach of these terms. Self-host operators may stop running the software at any time.
        </p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the maximum extent permitted by law, Domi Ops and the operator are not liable for
          indirect, incidental, or consequential damages, or for lost data, grades, or health
          records. Total liability for Cloud in any twelve months is limited to the fees you paid
          for that period (or $0 if you are on a trial or self-host).
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of the United States, without regard to conflict of
          law rules. If a provision is unenforceable, the rest remains in effect.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
        </p>
      </section>
    </div>
  );
}
