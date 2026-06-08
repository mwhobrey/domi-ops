# Household Drive — design spike

*Spike only — no implementation. Module name: **`drive`** (nav: `/drive`).*

## Question

Should whome replace HomeHub **Shared Cloud** with a household-scoped **Drive** — web-native object storage on MinIO with folders, discoverability (pin/tags/search), and cross-module file links — architected for quotas and public share links in Phase 2?

## whome today

- **S3/MinIO** wired (`ensureS3ReadyOnce`, presigned PUT, object buffer) — avatars, school submission artifacts, shopping receipts.
- **HomeHub file import** → `imports/{householdId}/files/…` via `packages/import-homehub/src/mappers/files.ts` — **no product UI**.
- **`/api/core/files`** — not implemented (runbook `04_CURRENT_STATE.md`).
- **Notes** — pin, tags, search, household/private visibility, `note_shares` (WHO-61) — **reuse these UX/API patterns on Drive objects**, not as the primary storage metaphor.
- **School artifacts** — assignment-scoped uploads to separate S3 keys; candidate for **linking to Drive** instead of duplicating blobs.
- **Notices** (dashboard announcements) — text-only today; candidate for **attached Drive files**.
- **Nav** — no Drive slot yet. **Module flags** — default `core,school,calendar_sync` only.

## HomeHub “Shared Cloud” (external)

**User jobs:**

- Drop household docs where everyone can grab them on phone/tablet.
- Avoid emailing files or hunting in Google Drive.
- Quick access — not document management.

**What it is:** flat SQLite `file` list + `./uploads` volume; no folders, search, tags, or per-member ACL.

**Not replicating:** media downloader, PDF compressor, QR generator, recipe book, **desktop sync clients** (Dropbox model).

## Principles

| HomeHub weakness | whome approach |
|------------------|----------------|
| Flat list | **Folder tree** (Phase 2 UI; schema in v1) |
| No findability | **Pin + tags + search in v1** — non-negotiable |
| Siloed uploads per feature | **Cross-module links** — one file, many surfaces |
| Site password | Better Auth + household roles + **public share tokens (Phase 2)** |
| LAN dropbox | MinIO backend; whome owns metadata, ACL, quotas |

**Explicit non-goals:** block-level sync, version history, Office co-editing, Nextcloud parity, exposing raw MinIO URLs to browsers.

## Options

| Approach | Pros | Cons |
|----------|------|------|
| **A — Household Library** (flat list + links) | Fastest MVP | Wrong product shape for OSS/hosted; folders deferred forever |
| **B — Extend Notes** (attachments in markdown) | No new nav | Files buried; school/notices can't share blobs cleanly |
| **C — Household Drive** (tree + MinIO + cross-links) | Sellable, scalable, matches mental model | More schema/API work upfront |

## Recommendation

**Build Option C — Household Drive.**

Architect **folders, quotas, and public share links from day one** (schema + API contracts). Ship **Phase 1** without folder UI, quota enforcement, or public links — but do **not** ship without **pin, tags, and search**.

## Phased delivery

### Phase 1 — dogfood (v1)

**Ship:**

1. **Drive module** — `/drive`, nav icon, `drive` in `MODULES_ENABLED` (+ household toggle when runtime module gating lands).
2. **Flat root + upload/download** — presign PUT, authenticated proxy GET (school pattern). Keys: `drive/{householdId}/{objectId}/{safeFilename}`.
3. **Pin, tags, search** — same semantics as Notes (`pinned`, `tags_json`, `q` on title + filename + description). Tag suggestions endpoint. Sort: pinned → recent.
4. **Link items** — `kind=link` rows (title, URL) alongside `kind=file`; both support pin/tags/search.
5. **Visibility** — `household` (default) or `private` + `drive_shares` (clone `note_shares`).
6. **Cross-module references** — `drive_references` table + picker component; see below.
7. **HomeHub import** — `file` rows → Drive objects under virtual **`/Imports`** folder (folder row created on first import).
8. **Role guards** — default member=write, child=read; admin-configurable per role ([WHO-115](https://linear.app/mikewhob-whome/issue/WHO-115)).

**Defer UI (schema ready):**

- Nested folder browser (create/move/rename) — objects have `folder_id` nullable → root until Phase 2.
- Quota hard-block — `households.storage_quota_bytes` / `storage_used_bytes` columns populated on upload; warn-only or admin meter optional.
- Public share links — `drive_share_tokens` table unused until Phase 2.

### Phase 2 — product-ready

1. **Folder tree UI** — create, rename, move, delete (non-empty guard).
2. **Quota enforcement** — block upload at cap; usage meter on `/settings` (hosted tier hook).
3. **Public share links** — expiring token → `GET /s/:token` API proxy; optional password; revoke from settings.
4. **Dashboard glance** — recent / pinned Drive items.

## Data model sketch

```sql
-- Folders (Phase 2 UI; v1 uses root + Imports only)
drive_folders (
  id uuid PK,
  household_id uuid FK,
  parent_id uuid FK NULL,  -- NULL = root
  name varchar(256) NOT NULL,
  created_at timestamptz
)

-- Objects (files + links)
drive_objects (
  id uuid PK,
  household_id uuid FK,
  folder_id uuid FK NULL,  -- NULL = root (v1 default)
  kind enum('file','link') NOT NULL,
  title varchar(256) NOT NULL,
  description text NULL,
  url text NULL,                    -- kind=link
  s3_key text NULL,                 -- kind=file
  content_type varchar(128) NULL,
  byte_size integer NULL,
  pinned boolean NOT NULL DEFAULT false,
  tags_json text DEFAULT '[]',
  visibility drive_visibility NOT NULL DEFAULT 'household',  -- reuse note_visibility enum or duplicate
  created_by_user_id uuid NULL,
  created_by_display_name varchar(64) NULL,
  created_at timestamptz
)

-- Private object sharing (clone note_shares)
drive_shares (
  drive_object_id uuid FK,
  member_id uuid FK,
  PRIMARY KEY (drive_object_id, member_id)
)

-- Cross-module links (v1)
drive_references (
  id uuid PK,
  drive_object_id uuid FK → drive_objects ON DELETE CASCADE,
  entity_type varchar(32) NOT NULL,  -- 'note' | 'school_submission' | 'notice' | ...
  entity_id uuid NOT NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz,
  UNIQUE (drive_object_id, entity_type, entity_id)
)

-- Phase 2: public links (schema only in v1)
drive_share_tokens (
  id uuid PK,
  drive_object_id uuid FK,
  token varchar(64) UNIQUE NOT NULL,
  expires_at timestamptz NULL,
  password_hash text NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz
)

-- Phase 2: quotas (columns on households in v1 migration)
-- households.storage_quota_bytes bigint NULL  -- NULL = unlimited (self-host default)
-- households.storage_used_bytes bigint NOT NULL DEFAULT 0
```

**Storage rules:**

- Postgres owns tree + metadata; MinIO keys are **flat** (`drive/{householdId}/{objectId}/{filename}`). Never infer folders from S3 prefixes.
- Upload: `POST /api/core/drive/presign` → client PUT → `POST /api/core/drive/objects`.
- Download: `GET /api/core/drive/objects/:id/file` — always proxied; never public bucket URL.
- Delete object: remove S3 object + decrement `storage_used_bytes` + cascade `drive_references`.

**Permissions:**

- All queries scoped by `auth.householdId`.
- Visible objects = household visibility + private shares (same filter pattern as `GET /notes`).
- Reference creation: user must have read access to the Drive object **and** write access to the target entity (e.g. edit note, post notice, submit school work).

## Cross-module linking (v1)

**Problem:** School submissions, notes, and notices should point at **one canonical blob** in Drive — not re-upload to three S3 keys.

**Pattern:**

| Surface | v1 behavior |
|---------|-------------|
| **Notes** | `DrivePicker` in edit sheet → creates `drive_references(note, id)`; render card/chip linking to `/drive?highlight=:id` or inline open proxy URL. Optional markdown `[[drive:uuid\|label]]` later. |
| **School** | Parallel artifact upload + optional Drive attach when `drive` module enabled ([WHO-119](https://linear.app/mikewhob-whome/issue/WHO-119)); legacy path unchanged when module off |
| **Notices** | Notice compose attaches zero or more Drive objects via picker → references rendered as download chips on `NoticeBoard`. |

**Shared UI:** `DriveObjectPicker` (search + tags + pinned filter) — same list API as `/drive`.

**API:**

- `POST /api/core/drive/references` — `{ driveObjectId, entityType, entityId }`
- `DELETE /api/core/drive/references/:id`
- `GET /api/core/drive/references?entityType=&entityId=` — resolve attachments for any module

**Integrity:** Deleting a Drive object removes references; UI shows “file removed” on linked surfaces.

## UI/UX flow (Phase 1)

- **Nav:** **Drive** (`FolderOpen`) between Notes and Expenses; hidden when module disabled.
- **Layout:** hybrid — **folder breadcrumb stub** (root only) + **ListPage** with pin/tags/search (mirror Notes, not a bare file table).
- **Add:** FAB or split button — Upload file | Add link.
- **Mobile:** large rows; file opens preview/download sheet; link opens new tab.
- **Accessibility:** pin toggle `aria-pressed`; labeled search; keyboard tag filters.

## Integration points

| System | Integration |
|--------|-------------|
| Notes | `drive_references`; picker in editor |
| School | attach/link Drive objects on submissions |
| Notices | attach Drive files to announcements |
| Settings | storage meter + share link admin (Phase 2); module toggle |
| S3 | existing presign/buffer helpers |
| Import | HomeHub `file` → `drive_objects` + `/Imports` folder |
| Shopping receipts | stay trip-scoped (optional link later) |

## OSS / hosted implications

- **Self-host:** `storage_quota_bytes = NULL` (unlimited), public links optional via env flag.
- **Hosted:** quota tiers enforced Phase 2; public links as premium or standard feature.
- **No sync client** keeps ops simple — browser + PWA sufficient for household use case.

## Product decisions (resolved)

1. **School uploads:** Parallel paths indefinitely — legacy artifact upload stays; Drive attach when `drive` module enabled ([WHO-119](https://linear.app/mikewhob-whome/issue/WHO-119)). Hosted: drive is optional paid module; never force purchase.
2. **Role permissions:** Admin-configurable read vs write per role (child/member/guest) in household settings ([WHO-115](https://linear.app/mikewhob-whome/issue/WHO-115)). Default: member=write, child=read.
3. **Link items:** Yes in v1 ([WHO-109](https://linear.app/mikewhob-whome/issue/WHO-109), [WHO-110](https://linear.app/mikewhob-whome/issue/WHO-110)).
4. **Quota:** Track bytes in v1; 10 GB dogfood default in schema; hard enforcement Phase 2 ([WHO-122](https://linear.app/mikewhob-whome/issue/WHO-122)).

## Linear project

**[Household Drive](https://linear.app/mikewhob-whome/project/household-drive-81a618305877)**

| Milestone | Issues |
|-----------|--------|
| M1 — Schema & API foundation | [WHO-109](https://linear.app/mikewhob-whome/issue/WHO-109), [WHO-112](https://linear.app/mikewhob-whome/issue/WHO-112) |
| M2 — Drive UI v1 | [WHO-110](https://linear.app/mikewhob-whome/issue/WHO-110), [WHO-111](https://linear.app/mikewhob-whome/issue/WHO-111) |
| M3 — Cross-module linking | [WHO-116](https://linear.app/mikewhob-whome/issue/WHO-116)–[WHO-119](https://linear.app/mikewhob-whome/issue/WHO-119) |
| M4 — Permissions & module gating | [WHO-113](https://linear.app/mikewhob-whome/issue/WHO-113)–[WHO-115](https://linear.app/mikewhob-whome/issue/WHO-115) |
| M5 — HomeHub import | [WHO-120](https://linear.app/mikewhob-whome/issue/WHO-120) |
| M6 — Phase 2 product-ready | [WHO-121](https://linear.app/mikewhob-whome/issue/WHO-121)–[WHO-125](https://linear.app/mikewhob-whome/issue/WHO-125) |

**Suggested build order:** WHO-109 → WHO-112 → WHO-113 → WHO-114 → WHO-110 → WHO-111 → WHO-115 → WHO-116 → WHO-117/118/119 → WHO-120 → Phase 2.

**Related (done):** [WHO-61](https://linear.app/mikewhob-whome/issue/WHO-61) note sharing, [WHO-96](https://linear.app/mikewhob-whome/issue/WHO-96) receipt presign, [WHO-72](https://linear.app/mikewhob-whome/issue/WHO-72) module toggles UI (runtime enforcement: WHO-113).

## Out of scope

- Desktop sync, versioning, full-text PDF search, Nextcloud parity.

## Decision

**Household Drive (Option C).** Phase 1: flat root, **pin/tags/search required**, cross-module `drive_references`, link items, HomeHub import. **Architect** folders, quotas, and public tokens in schema; ship folder UI, quota enforcement, and share links in Phase 2. **Not** a Dropbox clone — web-native MinIO-backed household storage with whome ACL and discoverability.
