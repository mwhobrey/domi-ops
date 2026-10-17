# Hosted household remediation

Priority: hosted household subscriptions. This ledger follows the 2026-10-16 audit;
an item is verified only when its evidence is recorded here. Local fixes do not
establish production deployment, payment-provider configuration, or OAuth approval.

| Order | Item | Required outcome | Status |
| --- | --- | --- | --- |
| 1 | A01 | School attachments cannot reference another tenant or a private Drive key | Implemented; restricted-role route regressions pass |
| 1 | A02 | Private school uploads; inventory and revoke legacy public object ACLs | New uploads verified; operator inventory tool ready; production ACL execution pending |
| 1 | A03 | Safe authenticated and shared file response headers | Implemented; active content and preview regressions pass |
| 1 | A04 | Bounded uploads, verified ownership and bytes, atomic quota accounting, orphan cleanup | Browser, snapshots and report paths verified; legacy reconciliation/cleanup tools verified locally; production execution remains |
| 1 | A14 | Nested privileged and tenant contexts restore the caller's database scope | Reproduced before fix; all 3 nested-context regressions pass |
| 1 | A15 | Goals and recurring bills have tenant policies and cross-parent write checks | Migration 0101; restricted-role isolation and forged-parent regressions pass |
| 1 | A16 | Snapshot/conversion downloads cannot fetch private networks or unbounded responses | Pinned public DNS, HTTPS redirects/time/body limits; 20 focused cases pass |
| 2 | A07 | Atomic webhook handling and household provisioning; duplicate subscription reconciliation | Verified locally; durable intents visible before provider calls; losing duplicates canceled; live provider reconciliation remains |
| 2 | A06 | Server-enforced subscription lifecycle with access to read and export data | Writes/jobs and GET materialization gated; reads/reports retained; legacy provider-date backfill remains |
| 2 | A09 | Owner billing portal for payment details, invoices, changes, and cancellation | Owner/customer binding verified; provider portal configuration and browser payment acceptance remain |
| 2 | A10 | Central subscription module bundle including Goals; eligible backfill | All six modules centralized; migration preserves partial entitlements and backfills old full bundles |
| 2 | A11 | RevenueCat stable identity, event ordering, trial and expiration handling | 5 lifecycle regressions plus owner/provider preflight and exact-package SDK checks pass; no fallback charge for another interval; product/app configuration and device/store acceptance remain |
| 2 | A08 | Account deletion cannot abandon an active paid household | Last-owner billing and ownership guards verified; assisted deletion/retention procedure documented |
| 3 | A05 | Adult invitations, acceptance, revocation, removal, and owner safeguards | 5 route regressions pass; hashed one-use invitation, verified exact email, soft revocation and history-preserving rejoin; SMTP acceptance remains |
| 3 | A12 | Enrollment includes the first and last household calendar dates | Implemented with request-isolated household dates; focused tests pass |
| 3 | A13 | Integration fixture cleanup cannot delete another suite's data | Own-household fixtures and exact-ID cleanup implemented; affected suites pass in parallel |
| 4 | Privacy | Withings categories, diagnostics processors, consent, and retention match implementation | Copy corrected; real Sentry transport scrub and optional metrics privacy regressions pass; new identity access/refresh tokens encrypted and ID tokens discarded; legacy token and production retention gates explicit |
| 4 | Portability | Household export with files and a tested self-host restore procedure | Encrypted archive CLI; 3 rehearsals against separate empty target verify new keys, private records/files, FK order, corruption and overwrite refusal; authorized Cloud delivery process still required |
| 4 | Onboarding | First useful School/Health workflow, invitations, and clear push setup | Useful-task links and revised checklist/docs implemented; real-device notification acceptance remains |
| 4 | Demo | Current synthetic dates, useful initial content, and guided role entry | Dates/DST and role entry implemented; shared synthetic-data banner and real-service connection guards verified; deployed demo reseed/grant inventory remains |
| 5 | Marketing | Cloud-first navigation and offer, mobile navigation, accurate feature/privacy/default claims | Production build/lint pass; 24 rendered page/viewport checks at 320/390/1280 pass; legacy Family offer removed |
| 5 | Positioning | Homeschool lead, health secondary, one $12/month or $120/year household offer | Implemented and compared with current official competitor pages; hypothesis and evidence gates documented, not claimed validated |
| 5 | Reuse | Assess and address course reuse and bulk rescheduling against current workflows | Draft course copy and selected-date preview/apply implemented; 3 permission, DST, stale-preview and student-history regressions pass; marketplace and automatic pacing explicitly deferred |
| 5 | Measurement | Privacy-preserving acquisition, activation, second-member, and retention funnel | Anonymous collector hardened; opted-in aggregate activation report with small-cohort suppression; acquisition/payment/renewal attribution deliberately requires consented pilot/provider receipts |
| 5 | Google | Diagnose sign-in separately from optional integrations; update verification recording guide | 7 real-handler fixture tests pass, including deferred invitation membership; optional scopes narrowed and recording guide current; production sign-in error, new video and Google approval still unresolved |

External acceptance gates: Google verification video and provider review; live
subscription and billing-portal configuration; deployment and legacy ACL changes;
real-device push/native purchase checks; customer interviews and cohort evidence.
These require evidence beyond local automated tests and must remain explicit.

Follow [HOSTED_LAUNCH_ACCEPTANCE.md](HOSTED_LAUNCH_ACCEPTANCE.md) in order. Technical
guides: [archives](HOUSEHOLD_ARCHIVES.md), [storage](UPLOAD_STORAGE_MAINTENANCE.md),
[positioning](marketing/HOSTED_POSITIONING.md), [measurement](HOSTED_MEASUREMENT.md),
[Google recording](google-oauth-verification-demo-script.md).

## Verification receipts

- Migrations 0000-0101 applied to a fresh disposable Postgres 16 archive destination;
  the source test database was also migrated through 0101. API tests use
  `domi_ops_app` with NOBYPASSRLS, real tenant middleware, and an HTTP S3 fixture.
- Upload route integration: 8 tests pass, covering tenant/private-file boundaries,
  private School uploads, ownership, single use, actual byte accounting, MIME
  override rejection, concurrent quota enforcement, idempotent orphan cleanup,
  generated snapshots/reports, and measured legacy storage reconciliation.
- Full hosted suite: **48 files / 802 tests pass** with 4 workers, restricted
  roles and a separate archive destination, including legacy storage reconciliation,
  recurring GET read-only enforcement and native owner/provider preflight.
- CI now provisions a separate, migrated, unseeded PostgreSQL archive destination
  and supplies its restricted-role URL, so the restore rehearsal runs in CI too.
- Non-integration suite: **173 files / 1,417 tests pass** using installed Node 24
  for the locally built SQLite addon. Hosted checks and package builds use pinned
  Node 22; a fresh Node 22 dependency install is needed for importer native-addon parity.
- Web and marketing production builds pass. API/web/worker/DB/marketing typechecks
  pass. Marketing ESLint passes; web ESLint has zero errors and remaining warnings.
- Marketing browser receipt: 8 pages × 3 widths, no overflow or page errors;
  mobile menu and primary offer visible. Screenshots/receipts are stored outside
  the repository under the dated Codex audit directory.
- Fixture browser checks pass for demo role entry, invitation URL-secret removal,
  signup entry, private-link creation, expired-subscription restart, and selected
  course date preview/apply, with zero page errors. Separate payment-mode checks
  verify disabled checkout provides support access and enabled checkout renders
  both billing intervals. No checkout was submitted by browser QA.
- Real object-store rehearsal: the archive CLI exported, dry-ran and restored a
  synthetic household between separate PostgreSQL databases and private MinIO
  buckets. The restored owner downloaded the private file (200); another household
  member was denied (404), and anonymous object access was denied (403). Conditional
  overwrite was refused, and private Health data decrypted with the destination
  key. Receipt: `minio-archive-receipt.json` in the dated Codex audit directory.
- No production database, storage object,
  billing subscription, or OAuth configuration has been modified.
