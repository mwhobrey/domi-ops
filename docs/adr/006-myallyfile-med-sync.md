# ADR 006: MyAllyFile medication sync

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-10-01 |
| **Related** | Linear [WHO-362](https://linear.app/mikewhob-whome/issue/WHO-362); MyAllyFile counterpart MYA-210 |

## Context

[MyAllyFile](https://myallyfile.com) is a separate product: a free emergency medical profile
(QR code plus PIN-gated page for first responders). People with complicated health needs change
medications often, and a stale emergency profile is worse than none. Domi Ops already tracks
medications properly (schedules, pauses, dose history); MyAllyFile stores `currentMedications`
as a plain list of strings.

## Decision

**One-way sync of medications, Domi Ops to MyAllyFile.** Domi Ops is the source of truth. The
MyAllyFile profile carries a derived snapshot. Nothing is read back.

- **v1 scope is medications only.** Domi Ops has no allergy or condition data.
- **Gated on the MyAllyFile side.** The integration needs MyAllyFile Plus or Pro. MyAllyFile
  checks the profile owner's plan on every sync; Domi Ops stays free and has no tier logic.
- **Hosted only.** Self-hosted instances do not get the link UI.
- **Parallel field.** MyAllyFile stores synced meds in its own encrypted `syncedMedications`
  field and leaves hand-entered `currentMedications` alone.
- **Per profile.** A link maps one Domi Ops member to one MyAllyFile profile (the primary
  profile or a dependent profile).
- **Opt-in per medication.** Nothing syncs until the user picks it. `private` meds are never
  auto-included.

## Contract v1

Base URL: `https://us-central1-myallyfile.cloudfunctions.net/<fn>`. All three functions are
plain HTTPS with a public invoker, JSON in and out.

### Link flow (paste a code)

1. In MyAllyFile the user opens a profile, then Connected apps, then "Connect Domi Ops". It mints
   a single-use link code (10 minute expiry, bound to that profile and owner). Plus/Pro only.
2. The user pastes the code into Domi Ops.
3. Domi Ops calls `exchangeLinkCode`:

```json
{ "code": "string", "instanceLabel": "string" }
```

Response 200:

```json
{ "token": "string", "profileId": "string", "profileName": "string" }
```

Link codes are `XXXX-XXXX`, Crockford base32 uppercase (no I, L, O, U), single use, 10 minute
expiry; input is case-insensitive and spaces and hyphens are stripped. An expired, used, or
unknown code returns 401 `code_invalid`. Tokens are opaque, up to 128 characters.

The token is long-lived, bound to one `profileId`, write-only for `syncedMedications`, shown
once, and stored by MyAllyFile only as a hash. Domi Ops stores it encrypted at rest and never
returns it from its own API. `instanceLabel` is private: MyAllyFile never shows it to responders.

### Sync

`POST syncMedications` with `Authorization: Bearer <token>`. Idempotent full snapshot.

```json
{
  "schemaVersion": 1,
  "sentAt": "2026-10-01T12:00:00.000Z",
  "medications": [
    {
      "externalId": "uuid",
      "name": "string, max 100",
      "dosage": "string or null, max 50",
      "instructions": "string or null, max 300",
      "schedule": "scheduled | prn | otc | interval",
      "paused": false
    }
  ]
}
```

- `schemaVersion` must be 1. `externalId` is required, a uuid, unique within the snapshot.
- Max 50 medications. `medications: []` is valid and clears the synced meds. Body max 64 KB.
- Response 200: `{ "ok": true, "count": n, "syncedAt": "ISO8601" }`. If `sentAt` is older than
  the stored one, MyAllyFile returns `{ "ok": true, "stale": true }` and writes nothing. Domi Ops
  treats `stale` as success.

| Status | `code` | Meaning | Domi Ops behaviour |
|--------|--------|---------|--------------------|
| 401 | `token_invalid` | Unknown token | Mark link `revoked`, stop |
| 401 | `token_revoked` | Revoked on the MyAllyFile side | Mark link `revoked`, stop |
| 403 | `entitlement_required` | Owner is not on Plus/Pro | Mark link `entitlement_required`, stop retrying, show upgrade state |
| 404 | `profile_not_found` | Profile deleted or not owned | Mark link `error` (broken), stop |
| 422 | `validation_failed` (+ `field`) | Bad payload | Record error, do not retry |
| 429 | `rate_limited` (+ `Retry-After`) | Per-token limit | Retry after the header |
| 5xx / network | | Transient | Retry with backoff |

### Unlink

`POST revokeLink` with the bearer token. Domi Ops calls it on unlink. The user can also revoke
from MyAllyFile. Either way MyAllyFile deletes the synced meds.

## MyAllyFile-side behaviour (for reference)

- Responder view, print and notifications show a separate "Synced from Domi Ops, last updated
  <date>" section. Paused meds are flagged. The section is read-only in the editor.
- Unlink or revoke deletes `syncedMedications` (stale meds on an emergency page are worse than
  none). A plan downgrade keeps the last snapshot with its date and rejects new syncs.
- Deleting a profile or account clears its links and synced data.

## Domi Ops-side rules

- A link is created by the subject member, or a grantee with `medications_access = write` in
  `health_member_acl`.
- Snapshot = the member's enabled, non-deleted, opted-in medications. Paused meds are included
  with `paused: true`. PRN and OTC meds follow per-link toggles.
- Sync is asynchronous and never blocks or fails a medication write. Bursts are debounced and an
  unchanged snapshot is not re-sent.
- Free-text fields are truncated to the contract caps before sending.

## Consequences

- The Domi Ops repo is public, so none of this is a secret; the only secrets are per-link tokens.
- Marketing and privacy copy on both sites must describe the opt-in data flow.
- Allergies and conditions are out of scope until Domi Ops models them.
