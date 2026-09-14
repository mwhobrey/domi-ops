# Native mobile store spike (WHO-287)

Companion to [ADR 005](./adr/005-mobile-distribution.md). Linear project: **Native / store**.

## Goal

Prove a Capacitor 8 shell can:

1. Ask for a household server URL (default `https://app.domi-ops.com`)
2. Probe `/api/healthz`
3. Load live `apps/web` in the WebView with the Capacitor bridge intact
4. Sign in with email/password
5. Skip service worker / PWA install chrome inside the shell

No store submit in this milestone.

## Repo layout

| Path | Role |
|------|------|
| `apps/mobile/` | Capacitor 8 shell (`appId: app.domiops`) |
| `apps/mobile/www/` | First-run server picker only |
| `apps/web/src/lib/native-shell.ts` | Runtime `Capacitor.isNativePlatform()` detect |
| `apps/web/src/components/PwaRegister.tsx` | Skips SW when native |

## How to build a debug APK

Requires **JDK 17 or 21** (Android Studio’s bundled JBR is currently Java 25 and breaks Gradle 8.14 — class file major version 69). Mise works well:

```bash
mise install java@21
# PowerShell:
$env:JAVA_HOME = (mise where java@21).Trim()
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

```bash
npm ci   # or npm install from repo root
cd apps/mobile
npx cap sync android
# write android/local.properties once:
#   sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
cd android
./gradlew.bat :app:assembleDebug   # Windows
# → app/build/outputs/apk/debug/app-debug.apk
```

Install on a USB-debuggable phone:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.domiops/.MainActivity
```

Or open in Android Studio (`npx cap open android`) and Run on an emulator / device.

iOS (macOS + Xcode):

```bash
cd apps/mobile
npx cap add ios   # once
npx cap sync
npx cap open ios
```

Signing keys, `google-services.json`, and APNs material stay out of git.

## Build smoke (2026-09-11)

- **Host:** Windows 11 + Android SDK (`platforms;android-36`), mise `java@21.0.2`
- **Device:** Pixel 9 Pro XL (`komodo`) via wireless debugging
- **Result:** `assembleDebug` **SUCCESS**; installed + launched `app.domiops`
- **Server picker:** boots (safe areas look fine under status bar / gesture nav)
- **Finding:** WebView `fetch` to `/api/healthz` → **Failed to fetch** (CORS: `https://localhost` → `https://app.domi-ops.com`). Fix: enable `CapacitorHttp` + call `Capacitor.Plugins.CapacitorHttp.get` in `www/app.js`.
- **After fix (CDP click Continue):** navigated to `https://app.domi-ops.com/login` — healthz + WebView load OK.
- **Note:** live hosted web still registers `sw.js` until the `isNativeShell()` skip is deployed; binary already has Preferences / CapacitorHttp / bridge on the remote origin (`allowNavigation: ["*"]`).

## Accepted spike findings (expected)

## Accepted spike findings (expected)

| Area | Finding |
|------|---------|
| Email/password | Works once `healthz` passes and `/login` loads |
| Google in WKWebView | May fail until WHO-288 native plugin + idToken exchange |
| Service worker | Must stay off in native (`isNativeShell()`) |
| Safe areas | SystemBars / `viewport-fit=cover` + CSS `env(safe-area-inset-*)` |
| Offline | Login wall if origin unreachable — by design |

## Follow-up milestones

| Milestone | Issue | Scope |
|-----------|-------|--------|
| M2 Auth | WHO-288 | Native Google + Sign in with Apple → Better Auth |
| M3 Push | WHO-289 | APNs/FCM + `push_subscriptions.platform` / `device_token` |
| M4 IAP | WHO-290 | RevenueCat → `household_subscriptions`; hide Stripe |
| M5 Submit | WHO-291 | Listings, privacy, TestFlight + Play internal |

## Device notes

- Device / OS: Pixel 9 Pro XL (komodo), Android 16-ish wireless debugging — 2026-09-11
- Safe-area header inset: server picker respects status bar / gesture inset; looks OK
- Back button / gesture: not fully exercised
- Keyboard over login fields: not fully exercised
- Email/password result: login WebView reached (`/login`); credentials not entered in this smoke
- Google WebView result (expected fail until M2): not tried
- healthz: CORS broke plain `fetch`; CapacitorHttp native GET works
