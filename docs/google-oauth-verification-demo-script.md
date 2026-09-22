# Google OAuth verification — demo video capture script

Capture-ready script for Google Trust & Safety **OAuth verification** (Domi / Whome household app).  
**Source of truth for scope strings:** `packages/auth/src/google.ts` (calendar + Docs connect) and Better Auth Google sign-in (`packages/auth/src/better-auth.ts` → `/auth/callback/google`).

**Related docs:** [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) · Privacy policy copy (`packages/marketing-ui/src/legal.tsx` → `/privacy`) · WHO-228 (narrowed Docs to `drive.file`).

**Recording environment (dogfood):** `https://whome.whobrey.me` — use the **same** GCP OAuth client ID and redirect URIs submitted in the verification form. Do not record against localhost unless that client is what Google is reviewing.

---

## A. Scope inventory (authoritative)

Domi uses **one** GCP Web OAuth client for three **separate** user consent flows. Each flow sends its own `scope` query parameter on the authorize URL.

### A.1 Sign-in (Better Auth — Google social provider)

| Scope string (as requested) | User-facing feature | Why it is needed |
|----------------------------|---------------------|------------------|
| `openid` | **Continue with Google** on `/login` | OpenID Connect identity for session creation |
| `https://www.googleapis.com/auth/userinfo.email` | Account email on profile; household member identity | Match Google account to Domi user / provision username |
| `https://www.googleapis.com/auth/userinfo.profile` | Display name and avatar on profile | Profile UI without a separate “edit name” step at first sign-in |

**Authorize path:** `/login` → **Continue with Google** → Google → `{PUBLIC_APP_URL}/auth/callback/google`  
**Redirect URI:** `https://whome.whobrey.me/auth/callback/google`

Better Auth does not pass custom scopes in code; Google receives the provider’s default OIDC set (equivalent to the three rows above). In **Google Cloud Console → OAuth consent screen → Data access**, ensure these match what you submitted (Google may show short labels like “See your primary Google Account email address”).

### A.2 Calendar connect (Domi API — `GOOGLE_CALENDAR_SCOPES`)

| Scope string | User-facing feature | Why it is needed |
|-------------|---------------------|------------------|
| `openid` | Same Google account as the member connecting | Ties the calendar token to the signed-in user |
| `https://www.googleapis.com/auth/userinfo.email` | Connection ownership / troubleshooting | Same as sign-in |
| `https://www.googleapis.com/auth/userinfo.profile` | (Bundled with connect flow) | Same as sign-in |
| `https://www.googleapis.com/auth/calendar` | **Calendar** module: import wizard, synced events, bidirectional push | List calendars (`calendarList`), read events for import/sync, create/update/delete events when sync mode is bidirectional (`packages/calendar-sync` — Calendar API v3 GET/POST/PUT/DELETE) |

**Start URL:** `/auth/google/calendar/start` (also linked from **Profile → Integrations** and **Calendar** setup UI)  
**Redirect URI:** `https://whome.whobrey.me/auth/google/calendar/callback`  
**OAuth params:** `access_type=offline`, `prompt=consent` (refresh token for background worker sync).

**Mike — scope breadth note:** `calendar` is the full Calendar scope (not `calendar.events.readonly`). Domi **writes** back to Google when the household uses bidirectional sync (edit/drag event in Domi → worker pushes to Google). Read-only scope would break that product behavior. Narrowing to a single calendar ID is a UX choice (import wizard picks calendars), not a different OAuth scope.

### A.3 Google Docs / Drive connect (Domi API — `GOOGLE_DOCS_SCOPES`)

| Scope string | User-facing feature | Why it is needed |
|-------------|---------------------|------------------|
| `openid` | Same as above | Account binding for `google_docs_connections` |
| `https://www.googleapis.com/auth/userinfo.email` | Same as above | Same as above |
| `https://www.googleapis.com/auth/userinfo.profile` | Same as above | Same as above |
| `https://www.googleapis.com/auth/drive.file` | **School** (Picker attach, test copy/submit, freeze export), **Reports** export to Google Docs/Drive, teacher **Export to Google Doc** | Per-file access: files user opens via **Google Picker** or creates via Domi upload+convert (`apps/api/src/lib/google-docs-export.ts`). No `drive` or `documents` scope (WHO-228 — Family Link–friendly). |

**Start URL:** `/auth/google/docs/start` (optional `?next=/school/assignment/{id}`)  
**Redirect URI:** `https://whome.whobrey.me/auth/google/docs/callback`  
**OAuth params:** `access_type=offline`, `prompt=consent`.

**Picker (not extra OAuth scopes):** Browser uses `GOOGLE_PICKER_API_KEY` + the user’s `drive.file` access token (`GET /api/core/google/docs/picker-session`). No additional user consent beyond `drive.file`.

### A.4 Not part of user OAuth consent (do not list in verification)

| Scope / credential | Used for |
|--------------------|----------|
| `https://www.googleapis.com/auth/firebase.messaging` | FCM HTTP v1 **service account** for native push (`packages/calendar-sync/src/native-push-delivery.ts`) — not shown on the user consent screen |
| Domi Ops Drive (S3/MinIO) | Household file storage — unrelated to Google Drive OAuth |

### A.5 Union list for Google Console + verification reply

Paste **every** scope your GCP project has on the consent screen **Data access** tab. It must match what the app requests. Minimum set implied by current code:

```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/drive.file
```

**Per-flow scope strings (exact `scope` query value, space-separated):**

- **Sign-in:** `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`
- **Calendar connect:** `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar`
- **Docs connect:** `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.file`

If the verification ticket only mentions **sensitive** scopes, still film **Calendar** and **`drive.file`** demos; include sign-in only if Google asked for all app scopes or login is in the same client submission.

---

## B. Pre-flight checklist (before OBS / camera)

### B.1 Environment and client

- [ ] Record on **`https://whome.whobrey.me`** (or the exact production URL on the OAuth client under review).
- [ ] GCP project = same **OAuth client ID** as `GOOGLE_OAUTH_CLIENT_ID` on that server.
- [ ] **Authorized JavaScript origins:** `https://whome.whobrey.me`
- [ ] **Authorized redirect URIs** (exact):
  - `https://whome.whobrey.me/auth/callback/google`
  - `https://whome.whobrey.me/auth/google/calendar/callback`
  - `https://whome.whobrey.me/auth/google/docs/callback`
- [ ] **OAuth consent screen → Data access:** every scope in [A.5](#a5-union-list-for-google-console--verification-reply) is added with justification text aligned to this doc.
- [ ] **Privacy policy URL** on consent screen loads (e.g. `https://whome.whobrey.me/privacy`).

### B.2 Fresh consent screen

- [ ] Use **Mike’s private throwaway Google account** (not Ally’s; no real household health/meds on screen).
- [ ] Revoke prior access: [Google Account → Third-party access](https://myaccount.google.com/permissions) → remove Domi / Whome app → confirm.
- [ ] Sign out of Domi or use a clean browser profile so connect flows hit `prompt=consent` where configured.
- [ ] Calendar and Docs connects use `prompt=consent` in code — expect full permission UI after revoke.

### B.3 Capture quality (Google rejection: obscured scopes)

- [ ] Resolution **1920×1080** or higher; OBS canvas matches monitor.
- [ ] Browser zoom **100%** (or 110% max if text still readable).
- [ ] Use **Chrome** (what most reviewers expect).
- [ ] On Google’s consent step, click **“See all …” / “Show all services”** (wording varies) so **every** permission line is visible.
- [ ] **Pause 5–8 seconds** on the consent screen; slow scroll if the list is long.
- [ ] Optional caption overlay: “OAuth client: Whome / Domi Ops — scopes must match Cloud Console submission.”

### B.4 App data safety

- [ ] Do **not** open **Health** with Ally’s medications or real PHI.
- [ ] School demo: Mike-owned test class/assignment or empty homeschool fixture.
- [ ] Calendar demo: throwaway calendar or “Domi OAuth Demo” Google calendar.

### B.5 Module gates

- [ ] Household has modules enabled: `calendar_sync`, `school`, `drive` as needed (`/settings` → household modules for owner).
- [ ] Signed in as **owner/admin** for connect buttons on Profile.

### B.6 Quick code/console parity check

```text
# Optional: while logged in, start Calendar connect and inspect the address bar on accounts.google.com
# scope= parameter must include calendar (calendar flow) or drive.file (docs flow)
```

---

## C. Shot-by-shot video script

**Target length:** **6–12 minutes** — clarity beats brevity; Google commonly accepts ~3–10 minutes if every sensitive scope is shown and exercised.

**Suggested filename:** `domi-ops-google-oauth-verification-whome-YYYY-MM-DD.mp4`

| Scene | Time (cum.) | Action | Voice / caption | Must be visible |
|-------|-------------|--------|-----------------|-----------------|
| **1 — Branding** | 0:00–0:30 | Open `https://whome.whobrey.me` (logged out). Show login page logo and name **Domi** / household app. | “Domi Ops is a household operations app: calendar, school, and shared planning.” | App name, home/login branding |
| **2 — Privacy beat** | 0:30–0:50 | Open `/privacy` in new tab; scroll to **Google account data** section briefly; return to app. | “We only use Google data for features the user enables; details in our privacy policy.” | Privacy policy Google section (no health data on screen) |
| **3 — Sign-in (if in scope submission)** | 0:50–1:40 | `/login` → **Continue with Google**. On consent: expand all services; read permissions; **Allow**. | “Sign-in uses OpenID, email, and profile to create a Domi account.” | Full consent list; redirect back to Domi dashboard |
| **4 — Profile integrations** | 1:40–2:00 | Go to **`/profile`** → scroll to **Google Calendar** and **Google Docs** sections. | “Calendar and Docs are optional connections, separate from sign-in.” | Both connect buttons, “not connected” or reconnect state |
| **5 — Calendar consent** | 2:00–3:30 | Click **Connect Google** (Profile or `/calendar` banner) → hits `/auth/google/calendar/start`. On Google: **expand all scopes**; linger; **Allow**. | “Calendar scope lets the user pick which Google calendars to import and sync events two-way when enabled.” | Every line mentioning Calendar; URL shows `redirect_uri=.../auth/google/calendar/callback` |
| **6 — Calendar import** | 3:30–5:00 | Land on `/calendar?connected=1&import=1` (or open **Import wizard**). Select a **test** Google calendar; preview → commit import. | “We only sync calendars the user explicitly selects.” | Wizard UI, calendar names, preview/commit |
| **7 — Calendar feature proof** | 5:00–6:30 | Show imported events in **Month** or **Week** view. Open an event; edit title or time; save. (If bidirectional sync enabled, mention worker pushes to Google.) | “This requires read/write Calendar API access, not read-only.” | Domi calendar grid with Google-sourced events; edit sheet |
| **8 — Docs consent** | 6:30–8:00 | **Profile → Connect Google Docs** (or `/auth/google/docs/start`). Expand all permissions on consent; linger; **Allow**. | “`drive.file` limits access to files the user creates or picks in Domi—not entire Drive.” | `drive.file` / “See and download files you created or opened with this app” (Google wording); `redirect_uri=.../auth/google/docs/callback` |
| **9 — Docs: reports export** | 8:00–9:00 | `/reports` → run export → **Google Docs** (or weekly report export). Complete flow; show Doc opens in Google. | “Reports export creates a new Doc via Drive—the scope we requested.” | Export sheet, success toast, Google Doc tab |
| **10 — Docs: school Picker** | 9:00–10:30 | `/school` → open a **test** assignment → **Add from Google** / Picker → select a file → attach. (Optional: student **Submit via Google** with a copy.) | “School materials use Picker + `drive.file` for attach, test copies, and submit.” | Picker UI, material on assignment; no real student PII |
| **11 — Optional denial demo** | 10:30–11:00 | Show export or Picker **disabled** message when Docs not connected (incognito or before connect). | “Without `drive.file`, these actions prompt reconnect.” | UI error/connect CTA |
| **12 — Close** | 11:00–11:30 | Return to `/profile` showing **connected** Calendar + Docs. | “OAuth tokens are encrypted at rest; user can revoke in Google Account settings.” | Connected status on profile |

**Adjust scenes 3, 5, 8** to match **only** the scopes Google flagged in the rejection email (e.g. skip sign-in if only Calendar + Drive were submitted).

---

## D. Submission notes

### D.1 Video

- **Length:** aim **6–12 minutes**; minimum ~4 minutes if only two sensitive scopes and demos are tight.
- **Format:** MP4, H.264; 1080p; clear UI text.
- **Audio:** voice-over or text captions explaining **which scope** each demo satisfies.
- **Upload:** attach in Google Cloud Console verification form or reply to Trust & Safety email with Drive/YouTube link per their instructions.

### D.2 Text to paste beside the video

Use this block (edit app name if Console differs):

```text
App: Domi Ops (Whome household deployment)
Homepage: https://whome.whobrey.me
Privacy policy: https://whome.whobrey.me/privacy

OAuth scopes requested by the application (must match Cloud Console Data access):

openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/drive.file

Flow 1 — Sign-in: /login → Google → /auth/callback/google
  Scopes: openid, userinfo.email, userinfo.profile
  Purpose: authentication and profile (name, email, avatar).

Flow 2 — Calendar connect: /auth/google/calendar/start → /auth/google/calendar/callback
  Scopes: openid, userinfo.email, userinfo.profile, calendar
  Purpose: user-selected calendar import/sync and bidirectional event updates.

Flow 3 — Docs/Drive connect: /auth/google/docs/start → /auth/google/docs/callback
  Scopes: openid, userinfo.email, userinfo.profile, drive.file
  Purpose: Google Picker attachments, school test workflow, report export to Docs/Drive (files user creates or opens via Domi only).

The demo video shows each sensitive scope on the expanded Google consent screen and demonstrates the corresponding in-app features immediately after grant.
```

### D.3 Checklist before submit

- [ ] Video shows **expanded** consent for **each** flow you request users to complete.
- [ ] Console **Data access** scopes = code (`packages/auth/src/google.ts`) = pasted list above.
- [ ] No real health/medication data visible.
- [ ] Redirect URIs in video match GCP credentials exactly.

### D.4 Follow-ups for Mike (not in scope of this doc PR)

- If Google asks to remove duplicate OIDC scopes from calendar/docs flows, that is a **code change** (separate issue)—calendar connect currently bundles `GOOGLE_LOGIN_SCOPES` intentionally.
- If verification is for **`app.domi-ops.com`** hosted beta instead of whome, re-record with that origin and the hosted OAuth client; redirect paths stay the same pattern under `PUBLIC_APP_URL`.

---

*Last updated from repo branch implementing this doc. Regenerate scope tables from `packages/auth/src/google.ts` if scopes change.*
