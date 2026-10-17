# Hosted launch acceptance

Local changes are ready for review through the [coverage ledger](HOSTED_AUDIT_REMEDIATION.md).
This document lists the external receipts needed before calling Cloud ready. It does
not authorize deployment, customer messages, provider changes or live purchases.

## 1. Review and deploy the coherent change

Review migrations 0098-0101 with the API, auth, web, worker and marketing changes.
The web workspace now declares the existing `@domi-ops/config` workspace so both
collector and browser use the same privacy policy code; `npm ci` applies the
checked-in lockfile. No new external package is required for that dependency.
Keep the existing deployment/release runbook: approved version tag and its workflow,
then live health/HTTP receipts. Do not use manual SSH deployment. Back up and rehearse
rollback before applying migrations; do not drop provenance tables to roll back code.

0099 intentionally refuses duplicate Stripe customer/subscription IDs. Inventory and
reconcile provider state before applying if duplicates exist. Do not delete records
or cancel uncertain purchases merely to make a unique index pass. Refresh legacy
active subscriptions' paid-through dates and past-due timestamps from their actual
provider. A legacy active row without a period end remains permitted until that
reconciliation; document the exception rather than assuming expiry enforcement.

Run the [storage maintenance procedure](UPLOAD_STORAGE_MAINTENANCE.md): private
School ACLs, bucket-policy inspection, household byte/provenance reconciliation,
and abandoned-file cleanup. Snapshot/report files now count toward storage. Legacy
foreign or multiply claimed file references require review; tools fail closed.

## 2. Payments and household lifecycle

Configure Stripe's customer portal for the intended products/prices, payment method
updates, invoices, allowed plan changes and cancellation. Match the $12/$120 prices
and 14-day card-required trial. Keep checkout disabled on marketing until configured.

In test mode, capture browser-to-provider-to-webhook receipts for monthly and annual
checkout, duplicate submission, lost/retried callback, setup and one-household owner
attachment, payment failure, payment recovery, scheduled cancellation, expiry,
read/report access after expiry, portal invoices/payment update, and paid restart
without a second trial. Verify amounts, currency, taxes and renewal text on the
provider checkout. A signed fixture webhook proves handler logic, not provider setup.

Verify owner transfer and the account-deletion support path for sole owners with
active Stripe or store subscriptions. Scheduled cancellation is still active until
the period ends; immediate account deletion may need assisted cancellation or
ownership transfer. Confirm refund and dispute handling with real provider state.

For native builds, configure RevenueCat product/app/environment/entitlement
allowlists and webhook secret. Test purchase, trial, restore, renewal, billing issue,
cancellation, expiry and out-of-order delivery with sandbox devices. Do not create a
second Stripe subscription for an active store household. Store acceptance and
device receipts remain separate from API fixture tests.

Native purchase/restore first checks the signed-in actor and current provider at
`GET /api/billing/purchase-access`; unconfigured stores, non-owners and active web
subscriptions cannot proceed through the client. Match offering package identifiers
to `starter_monthly`/`monthly`/`$rc_monthly` or
`starter_annual`/`annual`/`$rc_annual`. A missing selected interval is an error, with no
fallback charge for another package. Verify that exact behavior on store devices.

## 3. Google recording and provider acceptance

Google sign-in remains an external blocker reported by the owner. Local handler
tests pass but do not reproduce the production consent/review failure. Capture the
exact production error and Google client configuration before assigning a cause.

Deploy the final scope request first, then record using the updated
[verification script](google-oauth-verification-demo-script.md). Login requests
`openid email profile`; optional Calendar requests `calendar.calendarlist.readonly`
and `calendar.events`; optional Docs/Picker requests `drive.file`. Use the same
production client IDs, redirects, verified domains and published privacy policy
that the recording demonstrates. Submit the new video through the provider's review.

Test fresh grants as well as reconnects. Previously granted broad permissions do
not shrink just because the code requests fewer scopes. New Better Auth access and
refresh writes are encrypted with `SESSION_SECRET`, and ID tokens are discarded;
legacy identity tokens need operator backfill or a controlled reconnect. Never
rotate the session secret blindly or replay uncertain external operations. Optional
Calendar/Docs credentials use the separate instance encryption key.

## 4. Private data operations and usability

Verify transactional invitation and verification email delivery. Exercise a new
adult's exact-email acceptance, mismatched-account rejection, child login, role
changes, revocation and reinvitation. Verify removed members receive no subsequent
household pushes. Test iOS installed-PWA and Android/desktop permission flows on real
devices; a rendered notification button is not proof of delivery.

Rehearse an authorized private household archive and restore using
[HOUSEHOLD_ARCHIVES.md](HOUSEHOLD_ARCHIVES.md). Agree the affected-adult authorization
and secure delivery process before offering full archives. Keep permission-limited
reports available while subscriptions are read-only.

Set and verify the actual database/object backup rotation, Sentry retention,
telemetry and feedback retention, and restricted operator access. Add a deletion
case checklist: verify requester and affected scope, settle billing, revoke
integrations, delete/anonymize live database and object records, record permitted
exceptions, confirm backup expiry and prevent reintroduction during recovery.
The public 30-day verified-request target requires a working support process.
No production retention settings or deletion case has been verified here.

After deployment, use a fresh synthetic demo reseed only under the demo runbook.
Do not reset a live demo database casually. Check current dates, useful School and
Health examples and all three role entries. Demo protection prevents new real
service connections; previously stored demo credentials/grants require operator
inventory and revocation if any exist.

## 5. Positioning acceptance

Use [the positioning decision](marketing/HOSTED_POSITIONING.md) and
[measurement plan](HOSTED_MEASUREMENT.md). The implementation and current competitor
pages support a focused offer; they do not establish product-market fit. Collect
actual activation, paid-renewal, household participation and support-cost evidence
before expanding marketing spend or adding tiers.
