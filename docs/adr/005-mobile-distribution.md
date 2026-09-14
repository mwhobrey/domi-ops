# ADR 005: Mobile distribution (native app store presence)

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-25 (revised 2026-09-11) |
| **Related** | [ADR 002](./002-marketing-site-topology.md), Aetherbound [AET-192](https://linear.app/aetherbound/issue/AET-192) / `docs/native-mobile-store-delivery.md` |

## Context

Domi Ops ships as a PWA today (installable, Web Push, offline-capable shell). The question:
should Domi Ops also have app store presence, and/or native mobile apps?

Two axes evaluated, not one:

1. **App store distribution** — discoverability (people search app stores for "family
   organizer" the way they'd search for Cozi), perceived legitimacy vs. "visit a website
   and Add to Home Screen," which most non-technical users don't know exists as a pattern.
2. **Native app quality / OS integration** — animations, gestures, deep OS features,
   and specifically **home-screen widgets**, which are strictly native on both platforms.
   Neither iOS WidgetKit nor Android's widget system can be hosted from web content —
   there is no PWA shortcut for widgets on either platform, wrapped or not.

Additional constraint locked 2026-09-11: the store binary must support a **Bitwarden-style
server URL** (default `https://app.domi-ops.com`, any self-host origin). That makes origin
dynamic and rules out Android Trusted Web Activity (Digital Asset Links are origin-locked).

## Decision

**Wrap, don't rewrite. Capacitor 8 on both iOS and Android. Remote WebView of live `apps/web`.**

| Platform | Path | Why |
|----------|------|-----|
| **Android** | Capacitor 8 WebView | Same shell as iOS; TWA rejected (origin is user-configurable). |
| **iOS** | Capacitor 8 WebView | Same shell. Apple 4.2 risk mitigated with native chrome (server picker, push, IAP, SystemBars), not a rewrite. Apple Developer account already held. |

**Native shell responsibilities** (not the WebView):

- Server URL picker + `/api/healthz` probe before the WebView commits
- Native Google Sign-In + Sign in with Apple (popup/redirect die in WKWebView; SIWA required once Google is offered on iOS)
- APNs / FCM push (WKWebView has no Web Push; med reminders cannot defer this)
- RevenueCat → same `household_subscriptions` grant path as Stripe (no Stripe Checkout in the binary)

**Product UI** stays live `apps/web` at the chosen origin. Session cookies remain same-origin on that origin (Better Auth `/auth/*` proxy). Web deploys reach store users without a store review; native plugin / IAP / shell changes need a binary.

Checked against Aetherbound's Capacitor wrap (AET-192 Phase 1 spike). **Copy:** Capacitor 8 both stores, spike-first, no Stripe in binary, RevenueCat, native Google plugin, SIWA, disable SW in native, SystemBars/safe areas, `appId` as a one-way door. **Do not copy:** bundling the Vite `dist` into the APK — Domi Ops is Next.js SSR against a household server; a packaged SPA on `capacitor://localhost` would force cross-origin cookie/Bearer surgery and a second UI surface.

### Explicitly rejected

| Option | Why |
|--------|-----|
| **TWA (Android)** | Origin-locked via Digital Asset Links; incompatible with user-entered server URL. |
| **Bundled SPA extract of `apps/web`** | Capacitor is still a WebView — does not fix OAuth/IAP/push. Same-origin Better Auth cookies + Next BFF would need a rewrite. ADR already rejects a second UI surface. |
| **React Native / Flutter rewrite** | Permanently triples delivery cost per feature. Cap shared types/logic, not components. Solo-maintained surface area (calendar, school, health, drive, chores, expenses) cannot absorb that tax until wrappers demonstrably lose users. |

**Widgets** stay out of scope — need Swift/WidgetKit and Kotlin/Glance regardless of wrap vs rewrite. Defer until hosted demand shows up.

## Consequences

**Positive**
- New web features ship to store users on the next web deploy (remote WebView).
- One Capacitor shell for both stores (matches Aetherbound ops model).
- Self-host users get the same binary; they type their URL and never see IAP.

**Negative**
- Native UX fidelity capped at WebView ("good web app," not "native app").
- Apple 4.2 is hotter than a bundled game: native chrome is the rebuttal, not listing copy that says "website."
- Offline is a login wall if the chosen origin is unreachable (`healthz` gate).
- Push, SIWA, and RevenueCat are real native work before first public submit — cannot ship a hollow shell.

## Implementation shape

See Linear project **Native / store** and [native-mobile-store-spike.md](../native-mobile-store-spike.md).

| Milestone | Scope |
|-----------|--------|
| M0 — Decision | This ADR |
| M1 — Spike | `apps/mobile` Capacitor 8, server URL, healthz, email/password WebView, skip SW; internal APK/sim only |
| M2 — Auth | Native Google + Sign in with Apple → Better Auth session on chosen origin |
| M3 — Push | APNs/FCM beside VAPID; worker delivery; profile toggles |
| M4 — IAP | RevenueCat → `household_subscriptions`; hide Stripe in native |
| M5 — Submit | Listings, privacy/account deletion, TestFlight / Play internal → public |

`appId`: `app.domiops` (one-way door — lock before first Play/Apple/Firebase record).
