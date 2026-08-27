# ADR 005: Mobile distribution (native app store presence)

| Field | Value |
|-------|-------|
| **Status** | Proposed — loosely locked in 2026-08-25, not yet scheduled or built |
| **Date** | 2026-08-25 |
| **Related** | [ADR 002](./002-marketing-site-topology.md) |

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

## Decision

**Wrap, don't rewrite — for now.**

| Platform | Path | Why |
|----------|------|-----|
| **Android** | Trusted Web Activity (TWA) | Google's own blessed pattern for exactly this — wraps the existing PWA into a Play Store listing with minimal native code and low review risk. |
| **iOS** | Capacitor (or a thin native WKWebView shell) | Same app, wrapped. Carries real review risk under Apple's "minimum functionality" guideline (4.2) unless it leans on what's already native (push) and adds enough native feel to clear review — not a rubber stamp, but not a rewrite either. Apple Developer account already held (sunk cost, not a new commitment). |

**Explicitly rejected for now: React Native / Flutter full rewrite.** Reimplementing the UI
in a separate framework is not code reuse from `apps/web` (at most shared TS types/logic,
not components), and — the real cost — it **permanently triples delivery cost per feature**
going forward: every future change ships to web, iOS, and Android as three separate
implementations, three test passes, two store review cycles. For a project with this much
active surface (calendar, school LMS, health/PHI, drive, chores, expenses — still actively
growing) run largely solo, that ongoing tax outweighs the native-polish gain until there's
evidence the wrapper approach is actually losing users over it.

**Widgets are explicitly out of scope for this decision** — they need real native code
(Swift/WidgetKit, Kotlin/Glance) regardless of wrapper vs. rewrite, and are deferred
independent of which mobile path wins, until there's demand from real hosted users.

## Consequences

**Positive**
- New features ship to web/PWA/wrapped-native simultaneously — same deployed Next.js app.
- Android path is close to zero marginal cost on top of the existing PWA.
- No new framework, language, or hiring need to execute this.

**Negative**
- Native UX fidelity is capped at what a webview can deliver — animations, gestures,
  true native feel will always read as "good web app," not "native app."
- iOS review is not guaranteed on first submission; budget for at least one review cycle.
- Widgets stay off the table on this path — revisit only if demand shows up.

## Not yet decided (deliberately deferred)

- Timing relative to the hosted beta / public launch — not scheduled.
- Whether Android ships before, with, or after iOS.
- Concrete Capacitor/TWA implementation plan — this ADR records the direction, not a build plan.
