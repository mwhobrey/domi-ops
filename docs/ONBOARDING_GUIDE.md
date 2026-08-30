# First-login onboarding guide

**Status (updated 2026-08-29):** built in-app — `apps/web/src/components/OnboardingChecklist.tsx`, a dismissible checklist card on the dashboard, role-aware (owner/admin steps vs. member steps), rendered for every first-time visitor until dismissed. This doc remains the content source of truth; update the component's `OWNER_STEPS`/`MEMBER_STEPS` arrays if this doc changes.

**Implementation notes:**
- Persistence is server-side (`household_members.onboarding_steps_done` / `onboarding_dismissed_at`, migration `0055_onboarding_checklist.sql`), via `GET`/`PATCH /api/core/onboarding`. Domi Ops is meant to work everywhere someone picks it up — phone, tablet, desktop, installed PWA — so checklist progress has to travel with the person, not sit in one browser's local storage. A first pass used per-member `localStorage` (matching the existing `ProfileOnboardingBanner` nudge) and got replaced once that fell short of the cross-platform bar.
- It's a dashboard card, not a blocking modal — matches the rest of this app's style, doesn't gate access to anything.
- An admin cannot yet reopen a dismissed checklist for someone else from Settings — nothing surfaces the raw DB columns in any UI. Fine for now; revisit if it turns out people actually want that.
- Five of the six steps (everything but "Install on your phone," which is a browser action, not something in our own UI) are clickable and launch a `driver.js` guided tour — a spotlight card pointing at the actual setting, not just a link that dumps you on the page (`apps/web/src/lib/tours.ts`). A step whose target lives on another page (Calendar, Profile) sets a `sessionStorage` flag before navigating; `PendingTourRunner`, mounted on Settings/Calendar/Profile, picks it up and runs the tour once that page has rendered. Clicking the checklist item again re-runs the tour — it doesn't mark the step done by itself, the checkbox is still a separate click.

---

## For the household admin (owner)

You just finished setup and you're looking at an empty dashboard. Here's the order that gets you to a useful household fastest.

### 1. Household basics (2 min)

Go to **Settings**:
- Confirm household name and timezone are right (wrong timezone silently shifts every calendar reminder — check this first).
- Decide which modules you actually want on. Starter/self-host both include all five (`core`, `school`, `calendar_sync`, `drive`, `health`) — turning off ones you won't use keeps navigation simpler for everyone, not a storage or billing decision.

### 2. Bring in your household (3 min)

**Settings → Members:**
- Invite adults by email (or Google, if connected) — they'll get their own login.
- Provision username-only accounts for kids — no email required, good for anyone too young for their own inbox.
- Set roles: owner (you) vs. admin vs. member. Only owners/admins can change modules or provision new members.

### 3. Calendar (2 min)

- If you use Google Calendar: **Profile → Calendar → Connect Google**. Default sync mode is `import_only` (one-time pull, Domi Ops becomes source of truth after) — safest starting point, switch to bidirectional later if you want.
- If not: just start adding events directly, nothing to configure.

### 4. Notifications (1 min, optional)

- **Profile → Notifications** — turn on push for notices/reminders you care about. Requires installing the PWA first on iOS (Add to Home Screen), works directly in-browser on Android/desktop.

### 5. One real thing per module (5 min)

Don't set up in the abstract — add one real item to whichever modules you turned on: a chore, a shopping list item, this week's actual calendar events, an expense. An empty app feels unfinished; a half-populated one feels usable.

### 6. Install on phones

Each family member: open the app in their phone's browser → **Add to Home Screen**. This is what makes push notifications and the "just check Domi Ops" habit actually happen.

### Optional: customize "Today at a glance"

**Profile → Dashboard tiles** — the dashboard's glance row defaults to every module you have turned on, in a fixed order. If your household leans on three of them and ignores the rest, uncheck the ones you don't want and drag the order (up/down arrows, no drag-and-drop) to put what you actually check first. Per-member, not household-wide — everyone sees their own dashboard the way they want it. "Reset to default" clears it back to automatic.

---

## For household members (not the owner)

You've been invited or given a login by whoever set up your household.

### 1. Sign in and look around (2 min)

Whatever the owner turned on (Calendar, Chores, Shopping, Notes, Expenses, School, Drive) is what you'll see in navigation — modules the owner disabled just won't appear, that's normal, not a bug.

### 2. Your profile (1 min)

**Profile** — set your display name and avatar so the household can tell whose chore/note/event is whose.

### 3. Notifications (1 min, optional)

**Profile → Notifications** — turn on the ones relevant to you (chores, calendar, school, budget alerts). Nobody gets these by default; it's opt-in per person, per device.

### 4. Install on your phone

Add to Home Screen from your phone's browser. If someone set up push notifications for you (medication reminders, chore assignments), this step is what makes them actually arrive.

### 5. Do the thing you were actually invited for

If you were invited to co-manage the calendar, go look at Calendar. If it's chores, go look at Chores. Don't try to learn the whole app at once — most people only touch two or three modules regularly.

---

## What's explicitly out of scope for this doc

- Admin-side module *architecture* (entitlements, hosted vs. self-host differences) — that's `docs/SETUP.md` / `docs/adr/001-public-launch-scope.md`, not a new-user concern.
- Troubleshooting — see `docs/TROUBLESHOOTING.md`.
- This is not a marketing pitch — it assumes the reader already has an account and is trying to get useful out of it in the first sitting.
