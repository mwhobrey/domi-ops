# Google OAuth verification recording

Use the hosted household app and the exact OAuth client Google is reviewing.
The normal hosted origin is `https://app.domi-ops.com`; substitute the actual
reviewed deployment if different. Do not film the dogfood site or localhost for
a different production client. The public home page is `https://domi-ops.com`,
with its privacy policy at `https://domi-ops.com/privacy`.

## Before recording

The remediation branch narrows Calendar permissions and separates identity
permissions from optional connections. Deploy and verify that build before filming
these scopes. A video of the old full-Calendar grant does not demonstrate the new
request. Do not remove old scopes from a live client's configuration until the
intended rollout and test-account reconnect have been verified.

Use a synthetic Google account, fictional household and student records, an empty
test calendar, and a short test document. If necessary, revoke only that synthetic
account's previous grant so the full consent flow appears. Keep the address bar
visible for the OAuth client ID. Never show client secrets, refresh tokens, payment
details, actual medical information, or other household members' information.

Check the app name, verified domain, support email, home page and privacy URL in
Google Cloud Branding. In Data access, declare the exact scopes emitted by the
deployed app. Add the test account to the testing audience if the project is still
in testing. Confirm the recording/review account can use the app end to end.

All three callbacks must match the production client exactly:

```text
https://app.domi-ops.com/auth/callback/google
https://app.domi-ops.com/auth/google/calendar/callback
https://app.domi-ops.com/auth/google/docs/callback
```

## Permissions and visible proof

Source: `packages/auth/src/google.ts`, `packages/auth/src/better-auth.ts`,
`packages/calendar-sync/src/client.ts`, `sync.ts`, `push.ts`, and
`apps/api/src/lib/google-drive-export.ts`.

| Flow | Requested permission | Reason and demonstration |
| --- | --- | --- |
| Sign in | `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile` | Establish the member's identity, email, name and avatar. Show Google sign-in returning to the app. |
| Connect Calendar | `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Display the user's calendar list so they can choose calendars. Show the selection screen. It does not administer or delete calendars. |
| Connect Calendar | `https://www.googleapis.com/auth/calendar.events` | Import events and create, change or delete events when the user enables bidirectional sync. Show a Google event appearing in Domi Ops, then an app change reaching the selected Google calendar. |
| Connect Docs | `https://www.googleapis.com/auth/drive.file` | Read/modify files explicitly selected with Picker or created by the app. Show picking one school material and creating a new exported report document. No full Drive or Docs-wide scope is requested. |

Calendar and Docs connections request offline access for refresh tokens. They are
optional and separate from sign-in. FCM's service-account messaging permission and
Domi Ops' own file storage are not user Google consent scopes.

The Calendar endpoints used here are calendarList.list, colors.get and event
list/get/insert/update/delete. Google's method documentation permits the narrowed
scopes: [calendar selection](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list),
[colors](https://developers.google.com/workspace/calendar/api/v3/reference/colors/get),
[event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[event deletion](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).
This is a code and documentation mapping; complete a live synthetic-account sync
check before claiming acceptance. A read-only event scope cannot support the
app's bidirectional event changes. The app does not need calendar administration.

Google classifies `drive.file` as a non-sensitive, per-file scope in its
[Drive authorization guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
Still show the Docs flow when it is part of the submitted app demonstration.

## Recording sequence

Aim for a clear 6-10 minute recording; that is a production suggestion, not a
Google duration requirement. Record at readable resolution. Expand every consent
section, scroll the whole list, and hold each permission list long enough to read.

1. Open the public home page and privacy policy. Show the Google data explanation
   and the app's name. Open the reviewed hosted app.
2. Sign in with the synthetic Google account. Show the consent/account flow,
   matching app name and OAuth client ID in the address bar, then the successful
   return to the household. Do not claim a successful sign-in if Google blocks it.
3. Open Profile integrations and connect Calendar. Show the complete expanded
   permission list and grant it. Explain calendar selection and event changes.
4. Select only the test calendar. Import a uniquely named synthetic event. Show
   that event in Domi Ops and in Google Calendar.
5. Enable bidirectional sync for the test calendar. Create a synthetic event in
   Domi Ops, show it in Google, change its title/time in Domi Ops and verify the
   Google change, then delete that test event and verify the Google deletion.
   Wait for actual worker completion. Narration about intended behavior is not
   evidence that event-writing permission is used.
6. Connect Docs separately. Expand and show the per-file permission. Use Google
   Picker to select the synthetic school document and show the attachment.
7. Export a fictional report to Google Docs/Drive. Open the newly created file and
   show its content. Explain that unrelated Drive files are outside `drive.file`.
8. Show how the user disconnects the optional integrations and where they can
   revoke access in their Google Account. Sign-in and household data remain
   separate from the optional connection controls.

If a step fails, fix or disclose it before submitting; do not splice a successful
flow from another client or deployment into the review. Follow any specific
requirements in Google's review email in addition to this guide.

Upload the demonstration as an unlisted YouTube video and confirm the reviewer can
open it. Google's [sensitive scope verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
requires showing the grant process and the functionality enabled by the requested
scopes, including the sign-in flow when used. The branding, client ID, submitted
scope list, video, and deployed behavior need to agree.

## Sign-in diagnosis and acceptance receipt

Record these facts privately without tokens or authorization codes:

- Deployed Git SHA, public origin and OAuth client ID (the client ID is not secret).
- Exact outgoing `scope` and `redirect_uri` values for each flow.
- Google's exact policy/error code, current publishing/review status and whether
  the synthetic account is in the allowed audience.
- Actual callback result and application error code, if Google grants consent but
  the application fails afterward. Account-link conflicts, lost state cookies,
  or callback errors are application/configuration investigations, distinct from
  provider verification. Never repair them by deleting other users' account rows.
- Successful synthetic-account calendar selection, import, event create/update/
  delete, Picker attachment and report export after any scope change.
- Video URL, submission date and Google's eventual review result.

Status at implementation: local scope URL tests pass. No production Google client
has been changed, no live grant has been revoked, and provider approval or restored
Google sign-in has not been established by this work. Mike records/submits the
video and Google's review remains an external acceptance gate.
