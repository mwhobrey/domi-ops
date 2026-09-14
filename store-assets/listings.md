# Store listing drafts (WHO-291)

**Bundle / application id:** `app.domiops`  
**Name:** Domi Ops

## Short description (Play, ≤80)

Household ops — calendar, chores, health reminders, and school in one place.

## Subtitle (App Store, ≤30)

Household ops, one place

## Full description (draft)

Domi Ops is the household operations app for calendar, shopping, chores, notes, expenses, health medication reminders, and homeschool — whether you use Domi Ops Cloud or your own self-hosted server.

Connect to your server on first launch (hosted default or your URL), sign in, and get native push for the reminders that matter. Subscriptions for Domi Ops Cloud use the App Store or Google Play — not a browser checkout inside the app.

## Keywords (App Store draft)

household,family,calendar,chores,medication,homeschool,organizer

## Review notes (draft)

This binary is a Capacitor shell with native server URL selection, native push (APNs/FCM), Sign in with Apple / Google via native plugins, and RevenueCat IAP. The product UI loads from the household’s chosen origin so self-host and cloud share one codebase. It is not a thin website bookmark: without the native shell, Web Push and store billing cannot work on iOS.
