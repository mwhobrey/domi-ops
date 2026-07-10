# Google OAuth for whome

Your error (`invalid_request` / OAuth 2.0 policy) is almost always **Google Cloud Console config**, not Domi Ops code. The client named **Whobrey HomeHub** was likely set up for Flask on port **5000**; Domi Ops uses different URLs.

## 1. OAuth client type

Google Cloud → **APIs & Services** → **Credentials** → your OAuth 2.0 Client ID must be **Web application** (not Desktop, iOS, or TV).

## 2. Pick one local dev path

| Path | Browser URL | `.env` |
|------|-------------|--------|
| **Default — native** | `http://localhost:3000` | `cp .env.example .env` (`DOMI_OPS_DEV_PROFILE=native`) |
| Docker compose `web` | `http://localhost:3001` | `cp .env.docker.example .env` (`DOMI_OPS_DEV_PROFILE=docker`) |

Do not flip `PUBLIC_APP_URL` between 3000 and 3001 without updating Google Cloud redirect URIs. API startup logs OAuth callback URLs in development; `GET /health` returns `dev.oauthRedirects` when `NODE_ENV=development`.

## 3. Authorized JavaScript origins

Add the URL you open in the browser (no trailing slash):

| Environment | Origin |
|-------------|--------|
| Native `npm run dev` | `http://localhost:3000` |
| Docker compose web | `http://localhost:3001` |
| Production | `https://your.domain` |

## 4. Authorized redirect URIs (exact match)

whome sends redirects based on **`PUBLIC_APP_URL`** (Next proxies `/auth/*` to the API).

| Purpose | Redirect URI |
|---------|----------------|
| Sign in (Better Auth) | `{PUBLIC_APP_URL}/auth/callback/google` |
| Calendar sync | `{PUBLIC_APP_URL}/auth/google/calendar/callback` |
| Docs / Drive export | `{PUBLIC_APP_URL}/auth/google/docs/callback` |

**Local Docker example** (`PUBLIC_APP_URL=http://localhost:3001`):

```
http://localhost:3001/auth/callback/google
http://localhost:3001/auth/google/calendar/callback
http://localhost:3001/auth/google/docs/callback
```

Remove stale HomeHub URIs unless you still use them:

- `http://localhost:5000/auth/google/calendar/callback` (old Flask)

Optional override: set `GOOGLE_OAUTH_REDIRECT_URI` only for calendar if you need a different host (rare).

## 5. OAuth consent screen

1. **User type:** External (or Internal for Workspace-only).
2. **Publishing status:** **Testing** for personal/homelab use.
3. **Test users:** Add every Google account that will sign in (required in Testing mode).
4. **App domain:** Set **Application home page** and **Privacy policy** URLs. Google often blocks sign-in without a privacy policy link, even for localhost dev. Use your real domain or a static page you control.
5. **Scopes:** Login uses `openid`, email, profile. Calendar connect adds the Calendar scope. Docs export adds `documents` + `drive.file` (sensitive — Testing + test users is fine). Enable **Google Docs API** and **Google Drive API** in the same GCP project.

## 6. `.env` alignment

```env
PUBLIC_APP_URL=http://localhost:3001
API_URL=http://localhost:4000
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# Optional; default is PUBLIC_APP_URL + /auth/google/calendar/callback
# GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3001/auth/google/calendar/callback
```

After changing `.env` or GCP:

```bash
docker compose up -d api web --build
```

## 7. Verify the authorize URL

Open (while logged out):

`http://localhost:3001/login` → **Continue with Google**

On Google’s screen, check the address bar `redirect_uri` query param — it must **exactly** match `{PUBLIC_APP_URL}/auth/callback/google` in GCP (encoded form is normal).

## 8. Production (DigitalOcean + Caddy)

Use HTTPS everywhere:

- Origin: `https://home.yourdomain.com`
- Redirects: `https://home.yourdomain.com/auth/callback/google` and `.../auth/google/calendar/callback`
- `PUBLIC_APP_URL=https://home.yourdomain.com`

Add the production domain under **Firebase-style** authorized domains only if you use Firebase; Domi Ops does not require Firebase.

## 9. Google Picker (school assignment materials)

School teachers attach Google Docs/Drive files via the **Google Picker API** in the browser. Use the **same GCP project** as your OAuth client.

### Enable APIs

In **APIs & Services → Library**, enable:

- **Google Picker API** (required for Phase 2 school materials)
- **Google Drive API** and **Google Docs API** (likely already enabled for reports export)

### API key (browser)

1. **Credentials → Create credentials → API key**
2. **Application restrictions → HTTP referrers** — add every origin users open in the browser:
   - `http://localhost:3000/*` (native dev)
   - `http://localhost:3001/*` (Docker web)
   - `https://your.domain/*` (production)
3. **API restrictions → Restrict key** → allow **Google Picker API** (optional: Google Drive API)

If you already have an API key with matching referrer restrictions, add Picker API to its restriction list instead of creating a duplicate.

### `.env`

```env
GOOGLE_PICKER_API_KEY=AIza...
```

The key is **not** exposed in the Next.js bundle. The API returns it only from authenticated `GET /api/core/google/docs/picker-session`.

### OAuth client

No new OAuth client is required. Picker uses the existing Web client ID as `appId` and the teacher's `google_docs_connections` token (`documents` + `drive.file` scopes). Confirm **Authorized JavaScript origins** (§3) include your dev/prod browser URL.
