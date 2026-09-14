# @domi-ops/mobile — Capacitor store shell

ADR: [005-mobile-distribution.md](../../docs/adr/005-mobile-distribution.md) · Spike: [native-mobile-store-spike.md](../../docs/native-mobile-store-spike.md) · Linear: WHO-287

## What this is

A **Capacitor 8** native shell for App Store / Play Store. The product UI is **not** bundled — after a first-run server URL check (`/api/healthz`), the WebView loads live `apps/web` at that origin (default `https://app.domi-ops.com`).

Local `www/` is only the server picker.

## Prerequisites

- Node 22 + npm workspaces (repo root)
- Android Studio / Xcode for device builds
- **JDK 17 or 21** for Gradle (`mise install java@21`). Android Studio’s bundled JBR (Java 25) is too new for the Capacitor Gradle wrapper.
- One-time: `npm install` at repo root (pulls this workspace)

## Commands

```bash
# from repo root
npm install
cd apps/mobile

# first time only if android/ or ios/ missing
npx cap add android
npx cap add ios

npx cap sync
npx cap open android   # or: npx cap open ios
```

`android/` and `ios/` are committed (unsigned). Keep `google-services.json`, keystores, and APNs `.p8` out of git.

Debug APK (PowerShell):

```powershell
$env:JAVA_HOME = (mise where java@21).Trim()
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
# once: android/local.properties → sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
cd android
.\gradlew.bat :app:assembleDebug
# → app\build\outputs\apk\debug\app-debug.apk
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## appId

`app.domiops` — one-way door for store listings / push / IAP. Do not rename casually.

## Follow-ups

| Issue | Work |
|-------|------|
| WHO-288 | Native Google + Sign in with Apple |
| WHO-289 | APNs/FCM push |
| WHO-290 | RevenueCat IAP |
| WHO-291 | Store listings |
