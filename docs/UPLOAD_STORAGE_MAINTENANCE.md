# Upload storage maintenance

## Reconcile legacy accounting before enforcing the hosted file limit

After migrations and private-ACL review, run one household at a time using an
explicit restricted application-role `UPLOAD_MAINTENANCE_DATABASE_URL` and
`UPLOAD_MAINTENANCE_HOUSEHOLD_ID`, plus the S3 variables below:

```text
mise exec -- npx tsx scripts/maintain-upload-storage.mts reconcile
mise exec -- npx tsx scripts/maintain-upload-storage.mts reconcile --apply
```

Dry-run inventories referenced Drive files, School artifacts/snapshots and shopping
receipts, plus existing charged uploads, then reads actual object lengths. Apply
holds the household accounting lock, backfills consumed provenance for legacy
references, and replaces the counter with the measured total. Repeat is idempotent.
Missing files, foreign namespaces, and one legacy key claimed by multiple entities
stop the transaction for review; do not silence those errors by trusting metadata.
Avatars have a separate bounded upload and are excluded from this file counter.

This does not identify unreferenced historical objects that predate provenance.
Inventory those separately and establish ownership before deletion. Run abandoned
provenance cleanup after review; failed object deletions stay charged and retryable.

## Private access and cleanup

Migration 0098 adds server-owned browser upload provenance. Deploy API and migration
together. Upload URLs issued before this change must be requested again. Existing
Drive objects continue to work; existing School downloads are restricted to their
household's `school/<household-id>/` namespace. Review historical School artifact
keys for unexpected namespaces and cross-student references before release.

New School files are private and served through authenticated artifact URLs. Old
objects keep their existing ACL until an operator changes it. Inspect the bucket
policy too: removing an object ACL cannot override a policy granting public reads.
Do not enable public bucket reads for `school/`, `drive/`, receipts, or avatars.

The operator script reads explicit process environment only, never the checkout's
`.env`. Configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY and S3_REGION.
Inventory legacy public School ACLs first:

```text
mise exec -- npx tsx scripts/maintain-upload-storage.mts school-acls
```

Review the inventory, retain it privately, then run the same command with `--apply`
in the approved deployment environment. Re-run the inventory and verify an
unauthenticated direct object GET is denied while a permitted School download works.
If ACLs are disabled by the provider, check bucket ownership and policy instead;
do not blindly retry writes or make the whole bucket public. Do not record signed
upload URLs, tokens, or private document contents in maintenance logs.

Uploaded bytes count against household storage immediately, including School files,
shopping receipts, and unfinished uploads. Finalization uses recorded byte count
and content type. A grant can upload once and be attached once. Abandoned uploads
stay charged until their stored object is successfully deleted; expiration alone
never releases quota. A failed deletion leaves its record available for retry.

To review uploads more than one day past grant expiry, also set explicit
UPLOAD_MAINTENANCE_DATABASE_URL and UPLOAD_MAINTENANCE_HOUSEHOLD_ID. Use the scoped
application role. Run per household, review the receipt, then add `--apply`:

```text
mise exec -- npx tsx scripts/maintain-upload-storage.mts abandoned
```

Consumed uploads are excluded. Never remove referenced objects from this list by
guessing filenames. For household deletion or a failed database commit after an S3
write, separately reconcile the household's object prefixes with database references;
S3 and Postgres do not share a transaction. Retain backups and an inventory before
any deletion. This document and the script do not constitute production execution.
