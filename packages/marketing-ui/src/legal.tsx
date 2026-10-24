export const LEGAL_LAST_UPDATED = "October 23, 2026";
export const LEGAL_CONTACT_EMAIL = "privacy@domi-ops.com";

const bodyClass =
  "mt-8 space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)] [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--color-text)] [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:text-[var(--color-accent)] [&_a]:underline [&_code]:text-xs";

function Disclaimer() {
  return (
    <p className="mt-4 text-sm text-[var(--color-text-muted)]">
      The operator is a sole proprietor doing business as{" "}
      <strong className="text-[var(--color-text)]">Domi Ops</strong> (no limited liability
      company).
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
        <h2>Data protection mechanisms for sensitive data</h2>
        <p>
          <strong className="text-[var(--color-text)]">
            Security procedures are in place to protect the confidentiality of your data.
          </strong>{" "}
          <strong className="text-[var(--color-text)]">
            We use encryption to protect your information
          </strong>{" "}
          when it is stored or sent over the network.
        </p>
        <ul>
          <li>
            <strong className="text-[var(--color-text)]">In transit:</strong> Domi Ops Cloud serves
            the app and API over HTTPS (TLS). Browsers and our servers negotiate encrypted
            connections for sign-in, household data, and Google OAuth flows.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">At rest (OAuth):</strong> Optional Google Calendar
            and Docs connection tokens are encrypted using the instance encryption key.
            New sign-in access and refresh token writes are encrypted using the authentication secret;
            provider ID tokens are discarded after callback verification.
            older sign-in tokens require operator rotation or backfill. These server-held keys
            protect database storage, rather than providing end-to-end encryption.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">At rest (health):</strong> When the health
            module is enabled, sensitive health fields (for example titles, notes, medication names,
            dosage, instructions, and comparable vitals or log values) are encrypted at rest with
            the same <code>ENCRYPTION_KEY</code>. Dates, member assignment, and schedule times stay
            queryable without storing those values in plaintext.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Access controls:</strong> Household members
            see only content their role and per-module permissions allow. Private notes, Drive
            objects, and health records are further limited by per-record visibility and segment ACLs.
            These application controls are separate from infrastructure access: authorized operators
            with access to the database, stored files and the instance encryption key can access
            hosted data for service operation and support. Encryption is not end-to-end encryption.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">We do not sell your data</strong> to
            advertisers, data brokers, or other third parties.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Revoking Google access:</strong> Disconnect
            Google Calendar or Docs in household settings, or remove Domi Ops from your Google
            Account under{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Third-party access
            </a>
            . That stops Domi Ops from accessing Google on your behalf.
          </li>
        </ul>
        <p>
          <strong className="text-[var(--color-text)]">Self-hosted:</strong> the person who operates
          the server is responsible for HTTPS, backups, and protecting <code>ENCRYPTION_KEY</code>.
          The same encryption behavior applies when the key is configured.
        </p>
      </section>

      <section>
        <h2>Google account data</h2>
        <p>
          If you choose Google sign-in or connect Google services, Domi Ops accesses only the Google
          user data needed for the features you enable:
        </p>
        <ul>
          <li>
            <strong className="text-[var(--color-text)]">Sign-in</strong>: basic profile (name,
            email, profile photo) via OpenID Connect scopes used for authentication.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Calendar</strong>: when you connect
            Calendar sync, calendars and events you select so Domi Ops can display and sync household
            events.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Drive</strong>: when you enable Docs or
            Drive features, only files you create or open through Domi Ops (Google{" "}
            <code>drive.file</code> scope and the Google Picker), not your entire Drive.
          </li>
        </ul>
        <p>
          We use this Google user data <strong className="text-[var(--color-text)]">only</strong> to
          provide those features, for example signing you in, showing synced events, or exporting
          reports you request. We do <strong className="text-[var(--color-text)]">not</strong> use it
          for advertising, and we do <strong className="text-[var(--color-text)]">not</strong> use it
          to train general-purpose artificial intelligence or machine learning models.
        </p>
        <p>
          We do <strong className="text-[var(--color-text)]">not sell or transfer</strong> Google
          user data to third parties except service providers that help us run Domi Ops Cloud (for
          example hosting and email), and only as needed to operate the service. Our use and transfer
          of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </section>

      <section>
        <h2>Processors (when enabled)</h2>
        <ul>
          <li>
            <strong>Google</strong>: optional sign-in, Calendar sync, and Drive{" "}
            <code>drive.file</code> (Docs/Picker). See{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google&apos;s Privacy Policy
            </a>
            . See the token storage and legacy-token limits described above.
          </li>
          <li>
            <strong>Withings</strong>: optional blood pressure cuff and watch import, only if you connect a
            Withings account. See{" "}
            <a
              href="https://www.withings.com/us/en/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Withings&apos; Privacy Policy
            </a>
            . Access tokens are encrypted at rest on the instance.
          </li>
          <li>
            <strong>Object storage</strong>: S3-compatible storage (MinIO or a cloud bucket) for
            uploads.
          </li>
          <li>
            <strong>Email</strong>: SMTP you or the hosted operator configure (verification and
            transactional mail).
          </li>
          <li>
            <strong>Weather</strong>: Open-Meteo using coordinates you provide; no weather account
            is required.
          </li>
          <li>
            <strong>Web Push</strong>: browser vendors deliver notifications; subscription keys
            stay on the instance.
          </li>
          <li>
            <strong>Stripe</strong>: billing, trials, and invoices when hosted checkout is live.
            Card details are handled by Stripe, not stored in Domi Ops.
          </li>
          <li>
            <strong>Sentry</strong>: error diagnostics when the operator configures it. This runs
            independently of optional usage metrics. The application sends error types and code
            locations, build/platform metadata and limited job categories; it removes error messages,
            console arguments, account identifiers, request URLs, bodies, headers and local variables.
            Performance traces and breadcrumbs are disabled. Diagnostic retention depends on the
            operator&apos;s Sentry project settings; contact us for the hosted configuration. As with
            other network services, the provider receives connection metadata such as an IP address.
          </li>
          <li><strong>RevenueCat, Apple and Google Play</strong>: native store purchase and subscription status when store billing is enabled. Card details remain with the store.</li>
        </ul>
      </section>

      <section>
        <h2>Health module</h2>
        <p>
          Optional. Sensitive fields (titles, notes, medication names, dosage, instructions) are
          encrypted at rest with the instance <code>ENCRYPTION_KEY</code>. Dates, member assignment,
          and schedule times remain queryable. Access follows per-record visibility and segment ACL.
          There is <strong className="text-[var(--color-text)]">no admin override</strong> of
          private health data. Domi Ops is not a healthcare provider and is{" "}
          <strong className="text-[var(--color-text)]">not HIPAA-compliant</strong>.
        </p>
        <p>
          <strong className="text-[var(--color-text)]">MyAllyFile (optional).</strong> If you link a
          household member to a MyAllyFile profile, Domi Ops sends that profile the name, dose,
          instructions, schedule type, and paused status of that person&apos;s current medications,
          and sends an update whenever they change. Nothing is sent until you link, and nothing is
          read back. Anyone with that profile&apos;s emergency PIN can see the synced
          medications, as with any MyAllyFile profile data. The link is stored as an encrypted
          credential that you can revoke from either product; unlinking removes the synced
          medications from the MyAllyFile profile. MyAllyFile is a separate service with its own
          privacy policy.
        </p>
        <p>
          <strong className="text-[var(--color-text)]">Withings (optional).</strong> If you connect
          a household member to a Withings account, Domi Ops imports that person&apos;s blood
          pressure readings (systolic, diastolic, pulse), blood oxygen, body temperature and
          workouts (the activity, how long, and distance and calories when Withings has them), daily
          activity summaries (steps, distance, active minutes, active and total calories), and sleep
          summaries (start/end, time asleep/in bed, stages, awake time/count and sleep score), with
          when each was taken, as ordinary health entries, including past ones from the period you
          choose when you connect, and new ones as the cuff or watch syncs. They are protected like
          any other health entry. Withings&apos; permission for this covers body measurements and
          activity generally. Domi Ops reads these supported categories and registers notifications
          for new data; it does not upload or edit your Withings health records. Readings Withings cannot
          attribute to one person, such as on a cuff shared by a household, are left out until
          they are assigned in the Withings app. The connection is stored as encrypted
          credentials that you can revoke from either product. Unlinking stops new readings and
          asks Withings to stop notifying Domi Ops; readings already imported stay in Domi Ops
          until you delete them, and Withings keeps its own copy under its own privacy policy.
          Domi Ops does not change or delete health records at Withings. Import behavior varies by
          category: activity and sleep summaries may update when Withings reports a newer version;
          previously imported individual readings and workouts are deduplicated. Disconnecting
          stops future imports and leaves existing Domi Ops records until you delete them.
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
        <h2>Optional AI assistant connections</h2>
        <p>
          An adult member can connect a supported assistant after the instance operator and
          household administrator enable the integration. Each member approves their own
          connection and permissions. Approved reads send connection labels and timezone,
          shopping items, chores, and only explicitly selected planning notes to the chosen
          assistant provider. Current membership and record permissions still apply. The
          current integration does not directly access Calendar, School, Health, Drive or
          attachments, and cannot change household records. Do not select notes containing
          copied Google-derived, health, child or other excluded information for this workflow.
        </p>
        <p>
          The assistant is a separate service you choose. Its account settings and terms govern
          its retention, human review and model training. Review those settings and the
          provider-specific notice before approving access; Domi Ops cannot verify those
          settings or promise that the provider will not retain or use shared conversation
          content. Connection setup does not share your Domi Ops password, login session or
          Google credentials with the assistant.
        </p>
        <p>
          AI connections settings lets you review permissions, remove access or disconnect.
          Disconnect stops future reads; it cannot erase copies already held by the assistant.
          Security activity records tool names, outcomes, timing and response sizes rather than
          returned record content or raw tool arguments, with a 30-day activity retention
          window. Self-hosted operators administer their own deployment and retention.
        </p>
      </section>

      <section>
        <h2>Optional product metrics</h2>
        <p>
          Off by default on every household, self-hosted or Cloud. An owner or admin can turn it on
          in <strong className="text-[var(--color-text)]">Settings → Privacy</strong>. When on, we
          collect:
        </p>
        <ul>
          <li>Technical health: page load measurements and fixed JavaScript error categories</li>
          <li>
            Feature usage: which modules and actions get used (e.g. &quot;a chore was
            completed&quot;), never the content of what you created
          </li>
        </ul>
        <p>
          These events carry a randomly generated id stored in your browser (not your account,
          household, name, or email). The event store has no account or household identifier.
          Turning it off stops new collection and drops queued events; turning it on later starts a new random
          id, not a resumed history.{" "}
          <strong className="text-[var(--color-text)]">
            We do not sell this data, or any data, to anyone, ever
          </strong>. It is used only to find bugs and decide what to build next.
        </p>
        <p>
          Separately, anyone can send a bug report or feedback from their Profile page at any time,
          regardless of this setting. That message (and an optional reply email, if you choose to
          leave one) is sent because you chose to send it, not collected passively.
        </p>
        <p>Configured Sentry error diagnostics are separate from this opt-in setting, as described under Processors. Turning optional metrics off does not disable connected services, transactional email, billing, or operator diagnostics.</p>
        <p>Feedback uses a separate random id for each submission, so an optional reply email is
          not joined to your browser metrics id. Operators can also produce monthly activation
          counts from opted-in hosted households, using record existence and membership counts,
          without names or record contents. Cohorts smaller than five are suppressed. Random ids
          reduce direct identification; they are not a promise of formal anonymization.</p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          <strong className="text-[var(--color-text)]">Cloud:</strong> email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> to update profile
          data, revoke Google connections, or request account and household deletion. You may
          request deletion of your Cloud account and associated household data by emailing that
          address; we will delete or anonymize hosted records within{" "}
          <strong className="text-[var(--color-text)]">30 days</strong> of verifying your request,
          unless we must retain specific records for legal, security, or billing disputes (for
          example open invoices).
        </p>
        <p>
          <strong className="text-[var(--color-text)]">Self-host:</strong> the instance operator
          manages retention and deletion. An encrypted household archive can be restored to an
          empty self-host instance with the same schema, including referenced stored files.
        </p>
        <p>Cloud household archives are operator-assisted because they include other members&apos;
          private records. Contact the privacy address above; we verify the recipient and affected
          adults&apos; authorization. The archive uses a separate transfer key; hosted service keys,
          payment details, login sessions and external-service credentials are excluded. Report
          exports within your existing permissions remain available in the app.</p>
        <p>Canceling renewal does not delete records. Backup copies expire through the service&apos;s
          backup rotation; we confirm the applicable backup and diagnostic retention windows when
          handling a deletion request. Deleted data must not be reintroduced during disaster recovery.</p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can disconnect Google Calendar or Docs in household settings, revoke Domi Ops in your{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account
          </a>
          , disconnect a Withings cuff or watch from Health (Checks), disable Web Push, turn off optional
          modules (within what the instance enables), and
          turn anonymized metrics on or off. See also the <a href={termsHref}>Terms of Service</a>.
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
        <h2>Connected services</h2>
        <p>
          Optional integrations (such as Google, MyAllyFile, Withings and Stripe) are separate
          services with their own terms and privacy policies, and you are responsible for how you
          use them. Some require their own paid plan or membership (for example, for Withings accounts
          created after October 12, 2026, Withings requires Withings+ to share data with apps on its
          Start for Free API plan); Domi Ops does not provide or pay for those. Connect only accounts you own or are authorized to connect, and for a child or
          another household member only with their or their guardian&apos;s permission. Readings and
          records imported from a connected service are shown as received. Domi Ops is not a
          medical device and does not give medical advice; do not rely on it for diagnosis or
          emergency care. An integration may change or stop working if the other service changes
          or ends access.
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
          that requires a card and renews automatically unless canceled. Prices may change with
          notice. Cloud availability is shown on the pricing page. The household owner can manage
          web billing and cancel renewal in Settings; store purchases are managed through the store.
          Scheduled cancellation keeps paid access through the current period. Failed payments
          receive a 72-hour grace period from the recorded payment failure before product writes
          and background jobs pause. After access ends, household members can still read and export
          data they are permitted to access. Self-host remains free under MIT.
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
