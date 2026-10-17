# Household archives

The operator can export one household, including private records and referenced
stored files, and restore it to an empty self-host instance with the same schema.
This is separate from the permission-limited report exports in the app.

## Authorization and contents

A household owner cannot use this tool to bypass another adult's private Health,
Notes, Calendar or Drive permissions. Before delivery, verify the requester,
destination recipient, and affected adults' authorization, including former members
whose private records remain. Record approval in the support case, not the archive.
Resolve disputed access before creating or delivering a full archive. Children and
other dependents need an appropriate authorized representative.

The archive preserves household, member, record and file IDs, teaching content,
submissions, grades, Goals, recurring bills, record visibility, sharing rows and
encrypted sensitive fields. Private records remain private after restore.

It excludes payment subscriptions and receipts, checkout requests, sessions,
verification/reset tokens, public share tokens, invitations, push destinations,
notification queues, sync queues and external-service credentials. Only password
account hashes transfer; social-only users need a password/reset flow on the
destination. Google, Withings and MyAllyFile must be connected again. Existing
synced calendar entries become local events. Referenced external links and Google
documents remain links; they are not a backup of data held by those providers.

## Keys and preparation

Use a newly generated high-entropy `ARCHIVE_KEY` of at least 32 bytes for each
transfer. Deliver that key separately through an approved secure channel. Never
send the Cloud `ENCRYPTION_KEY` or `SESSION_SECRET` to a customer. The manifest and
each file use authenticated AES-256-GCM encryption. Sensitive field values are
rekeyed to the archive key, then to the destination key during restore.

The source database must use a non-owner **NOBYPASSRLS application role**. The tool
refuses superusers, BYPASSRLS roles and owners of tenant tables. It takes a
repeatable-read tenant snapshot; it never exports every row from global tables.
Users and credential hashes are selected only for exported household members.

Quiesce writes and migrations while exporting: a database snapshot alone cannot
freeze objects stored outside PostgreSQL. Ensure enough encrypted local disk space
and restrict access to the output directory. Do not use a synced public folder.

## Commands

Build shared packages first. Run with the repository's pinned Node runtime and
`tsx`; the script deliberately does **not** load the checkout's `.env`.

Supply these explicit environment variables without writing secrets into shell
history or a receipt:

- `ARCHIVE_DATABASE_URL`: source application role for export; empty destination for restore.
- `ARCHIVE_INSTANCE_ENCRYPTION_KEY`: the selected instance's existing field encryption key.
- `ARCHIVE_KEY`: separate transfer key.
- `ARCHIVE_HOUSEHOLD_ID`: source household UUID, required for export only.
- `ARCHIVE_S3_ENDPOINT`, `ARCHIVE_S3_BUCKET`, `ARCHIVE_S3_ACCESS_KEY`, `ARCHIVE_S3_SECRET_KEY`.
- Optional `ARCHIVE_S3_REGION` and `ARCHIVE_S3_FORCE_PATH_STYLE`.

```text
mise exec -- npx tsx scripts/household-archive.mts export <new-directory> --approved-private-data-export
mise exec -- npx tsx scripts/household-archive.mts restore <archive-directory>
mise exec -- npx tsx scripts/household-archive.mts restore <archive-directory> --apply
```

The first command's authorization flag confirms the checks above; it does not grant
approval by itself. Existing output directories are never overwritten. A successful
export writes `manifest.enc.json` last as its completion marker. Do not deliver a
directory without that marker and a successful count receipt.

Migrate an empty destination to the **exact source schema**, with fresh destination
keys. Do not seed demo, owner or QA data. Keep the destination app and worker
stopped. Dry-run restore decrypts and authenticates every file, checks checksums,
table/column inventories, household scope, foreign references and schema identity.
It refuses a non-empty database or destination household object namespace.

`--apply` rechecks the empty database under exclusive table locks, writes private
objects without replacement, and inserts rows with normal foreign keys and RLS
enabled. It changes the household to `self_host`, removes the hosted quota and
turns optional metrics off. It never disables constraints or deletes target data.

If object upload succeeds but a later database operation fails, PostgreSQL rolls
back while private object remnants can remain. Keep the app stopped, review the
receipt and exact archive-owned target keys, and remove only those remnants before
retrying. Never rerun with overwrite enabled. Never point restore at Cloud.

## Acceptance

After restore, reconcile target file accounting/provenance using
[storage maintenance](UPLOAD_STORAGE_MAINTENANCE.md). Verify a private Health record
decrypts, a private file downloads only for its intended viewer, School work and
grades agree, and former members remain revoked. Verify separate adult/child logins;
configure password recovery, HTTPS and backup retention before handing over access.
Reconnect optional integrations explicitly and review public file shares afresh.

The synthetic integration rehearsal uses two households, a separate empty PostgreSQL
destination, different source/transfer/target keys, private Health data and files,
folder hierarchy, School and Goals. It verifies tenant exclusion, credential and
subscription exclusion, checksums, wrong-key/damaged-file refusal and overwrite
refusal. This is local portability evidence; it is not a production disaster-recovery
receipt or a guarantee that third-party documents were copied.

A separate CLI rehearsal against local MinIO also passed export, dry-run and apply
between separate PostgreSQL databases with different source, transfer and target
keys. Through the restored API, the private file's owner received 200 and another
household member received 404; anonymous object access returned 403. MinIO refused
conditional overwrite, and private Health data decrypted with the target key.
This verifies the actual S3 adapter and restored download path using synthetic data.
