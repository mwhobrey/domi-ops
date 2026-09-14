# Store submission checklist (WHO-291)

Do **not** submit until M2–M4 are wired on a real device (native auth, push, RevenueCat).

## Accounts

- [ ] Apple Developer Program (already held per ADR 005)
- [ ] Google Play Console ($25 one-time) if missing
- [ ] Firebase project for Android FCM + `@capacitor-firebase/authentication`
- [ ] RevenueCat apps linked to App Store Connect + Play Console
- [ ] App Store Connect app record with bundle id `app.domiops`
- [ ] Play app record with application id `app.domiops`

## Privacy / legal

- [ ] Privacy nutrition labels (Apple) + Data safety (Play)
- [ ] Account deletion: Profile → Account → Delete account (`DELETE /api/core/profile/account`) live on the chosen origin
- [ ] Live `/privacy` and `/terms` on marketing site
- [ ] Honest listing copy — native chrome (server URL, IAP, push), not “a website”

## Assets

Screenshots: `npm run marketing:capture-screenshots` then crop for store sizes.

Place finals under:

- `store-assets/ios/` — 6.7", 6.5", 5.5" phone shots
- `store-assets/android/` — phone + 7" tablet if required
- `store-assets/listings.md` — title, subtitle, short/long description drafts

## Tracks

- [ ] TestFlight internal
- [ ] Play internal testing track
- [ ] Budget a 4.2 bounce; reply with native chrome evidence (server picker, IAP, push, SystemBars)

## Env (production)

```
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
APPLE_APP_BUNDLE_IDENTIFIER=app.domiops
FCM_SERVER_KEY=
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=app.domiops
APNS_P8_KEY=
REVENUECAT_WEBHOOK_SECRET=
NEXT_PUBLIC_REVENUECAT_IOS_KEY=
NEXT_PUBLIC_REVENUECAT_ANDROID_KEY=
```

Webhook URL: `https://app.domi-ops.com/api/billing/revenuecat/webhook`  
Auth header: `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`
