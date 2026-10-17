# First-login onboarding guide

**Status (updated 2026-10-17):** built in-app as `apps/web/src/components/OnboardingChecklist.tsx`, a dismissible dashboard checklist with separate owner/admin and member steps. Progress follows the member across devices. The shared demo suppresses the personal checklist and provides explicit parent, student and caregiver entry instead.

**Implementation notes:**
- Persistence is server-side (`household_members.onboarding_steps_done` / `onboarding_dismissed_at`, migration `0055_onboarding_checklist.sql`), via `GET`/`PATCH /api/core/onboarding`. Domi Ops is meant to work everywhere someone picks it up (phone, tablet, desktop, installed PWA), so checklist progress has to travel with the person, not sit in one browser's local storage. A first pass used per-member `localStorage`, matching the existing `ProfileOnboardingBanner` nudge, and got replaced once that fell short of the cross-platform bar.
- It's a dashboard card, not a blocking modal. Matches the rest of this app's style, doesn't gate access to anything.
- An admin cannot yet reopen a dismissed checklist for someone else from Settings; nothing surfaces the raw DB columns in any UI. Fine for now; revisit if it turns out people actually want that.
- Settings, Calendar and Profile steps can launch a `driver.js` guided tour of the real setting (`apps/web/src/lib/tours.ts`). The useful-task step links directly to enabled School/Health workflows, and installation gives browser instructions. Visiting a page does not itself mark the checkbox complete.

---

## First useful task

After confirming name and timezone, choose one real workflow before connecting integrations.

- **School:** provision a child login if needed, create a class, enroll the student,
  and create one assignment. Open it as the student, submit work, then review it as
  the teacher. Keep student and teacher logins separate. Existing courses can be
  reused as undated drafts; selected dated, unsubmitted assignments can be shifted
  after reviewing a household-timezone preview.
- **Health:** choose the intended household member, add one medication or check,
  record an appropriate observation, and verify the intended caregiver can see it.
  Review sharing explicitly; owner/admin status does not override private Health access.

Google, Withings, push notifications and phone installation can follow once that
workflow is useful. Local School and Health work does not require a Google grant.

## For the household admin (owner)

You just finished setup and you're looking at an empty dashboard. Here's the order that gets you to a useful household fastest.

### 1. Household basics (2 min)

Go to **Settings**:
- Confirm household name and timezone are right. Wrong timezone silently shifts every calendar reminder, so check this first.
- Decide which modules you actually want on. Cloud includes all six (`core`, `school`, `calendar_sync`, `drive`, `health`, `goals`); self-host availability follows the operator's configured catalog. Turn off unused modules to simplify navigation.

### 2. Bring in your household (3 min)

**Settings → Members:**
- Create an adult invitation in **Settings → Invite an adult**. Send it by email
  when SMTP is configured or privately share the join link. It expires after seven
  days and is bound to the invited email. The recipient signs in or creates and
  verifies that exact account, then accepts. Google login is optional and does not
  change which email may accept. Existing membership in another household is rejected.
- Provision username-only accounts for kids: no email required, good for anyone too young for their own inbox.
- Set roles: owner (you) vs. admin vs. member. Only owners and admins can change modules or provision new members.
- Revoke unused invitations. Remove access for a departing member without deleting
  household history; reinviting the same person reuses the retained member identity.
  Admins cannot remove owners or peers, and the last owner cannot be removed.

### 3. Calendar (2 min)

- If you use Google Calendar: **Profile → Calendar → Connect Google**. Default sync mode is `import_only`, a one-time pull with Domi Ops as source of truth afterward. It's the safest starting point; switch to bidirectional later if you want.
- If not: just start adding events directly, nothing to configure.

### 4. Notifications (1 min, optional)

- **Profile → Notifications:** turn on push for the notices and reminders you care about. iOS requires installing the PWA first (Add to Home Screen); Android and desktop work directly in-browser.

### 5. One real thing per module (5 min)

Don't set up in the abstract. Add one real item to whichever modules you turned on: a chore, a shopping list item, this week's actual calendar events, an expense. An empty app feels unfinished; a half-populated one feels usable.

### 6. Install on phones

Each family member: open the app in their phone's browser, then **Add to Home Screen**. This is what makes push notifications and the "just check Domi Ops" habit actually happen.

### Optional: customize "Today at a glance"

**Profile → Dashboard tiles.** The dashboard's glance row defaults to every module you have turned on, in a fixed order. If your household leans on three of them and ignores the rest, uncheck the ones you don't want and reorder with the up/down arrows (no drag-and-drop) to put what you actually check first. It's per-member, not household-wide, so everyone sees their own dashboard the way they want it. "Reset to default" clears it back to automatic.

---

## For household members (not the owner)

You've been invited or given a login by whoever set up your household.

### 1. Sign in and look around (2 min)

Whatever the owner turned on (Calendar, Chores, Shopping, Notes, Expenses, School, Drive) is what you'll see in navigation. Modules the owner disabled just won't appear. That's normal, not a bug.

### 2. Your profile (1 min)

**Profile:** set your display name and avatar so the household can tell whose chore, note, or event is whose.

### 3. Notifications (1 min, optional)

**Profile → Notifications:** turn on the ones relevant to you (chores, calendar, school, budget alerts). Nobody gets these by default; it's opt-in per person, per device.

### 4. Install on your phone

Add to Home Screen from your phone's browser. If someone set up push notifications for you (medication reminders, chore assignments), this step is what makes them arrive.

### 5. Do the thing you were actually invited for

If you were invited to co-manage the calendar, go look at Calendar. If it's chores, go look at Chores. Don't try to learn the whole app at once; most people only touch two or three modules regularly.

---

## What's explicitly out of scope for this doc

- Admin-side module *architecture* (entitlements, hosted vs. self-host differences). That's `docs/SETUP.md` and `docs/adr/001-public-launch-scope.md`, not a new-user concern.
- Troubleshooting: see `docs/TROUBLESHOOTING.md`.
- This is not a marketing pitch. It assumes the reader already has an account and is trying to get something useful out of it in the first sitting.
