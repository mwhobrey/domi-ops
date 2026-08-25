# Kort testbook — hosted beta walkthrough

**Internal note (Mike):** this is the first outside person to touch Domi Ops. Nobody but you has run any of the dogfood QA phases (`.cursor/runbook/06_DOGFOOD_TEST_PHASES.md`) — treat everything below as unverified against a real stranger until Kort actually runs it. Send him the section below the `---` as-is (or paste into an email/doc); keep this internal note out of what he sees. Capture his answers back into this file (or a copy) so the feedback survives past a Slack thread.

**Before sending:** confirm the smoke test in [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md) §7 passed with your own test-mode run first. Don't hand this to Kort until that's clean.

**Access:** Kort's login is `https://app.domi-ops.com` (real household, real data, real infra — not a sandbox). His promo code is single-use; if checkout errors partway through, don't have him retry blindly — check Stripe Dashboard for a stuck session before reissuing a code.

---

## Welcome (for Kort)

Thanks for being willing to kick the tires on this. Domi Ops is a household operations app — calendar, chores, shopping, notes, expenses, and (if you use it) homeschool tracking. You're the first person outside the family to use it, so the honest goal here is finding what's confusing, broken, or annoying *before* anyone else sees it — not making you say nice things.

Go through the phases below roughly in order, in your own browser, on your own time. For each one, jot down:
- Anything that didn't work the way you expected
- Anything you had to guess or re-read to figure out
- Anything that felt slow, ugly, or out of place
- Anything that just worked and felt good (this matters too — tell us what to keep)

Don't worry about being diplomatic. "This confused me" is more useful than "looks great!"

---

## Phase 1 — First impression (marketing site)

Before creating an account:

1. Go to `https://domi-ops.com` cold, like you found it from a link with no other context.
2. Read the homepage. What do you think this product does, in your own words?
3. Check the pricing page.

**Tell us:**
- What did you think Domi Ops was for, before reading closely?
- Was anything on the homepage confusing or unclear?
- Did the pricing make sense? Any surprises?

## Phase 2 — Checkout & signup

1. Click through to get hosted / start a plan.
2. Enter the promo code you were given separately (not in this doc).
3. Complete checkout.
4. Follow the setup wizard through to your first login.

**Tell us:**
- Did checkout feel trustworthy? Anything that made you hesitate?
- Did you understand what the promo code did (price shown, trial terms) before confirming?
- Did the setup wizard make sense? Anything you weren't sure how to answer (household name, timezone, etc.)?
- How many steps from "decided to try it" to "looking at my dashboard"? Did that feel like too many, too few, about right?

## Phase 3 — First look at the dashboard

1. Spend a couple minutes just looking around before doing anything.

**Tell us:**
- What did you expect to do first? Did the app guide you there, or did you have to hunt?
- Was it obvious what each part of the dashboard was for?

## Phase 4 — Try the core stuff

Work through these as a normal household would, not as a QA checklist — but note anything that trips you up:

- [ ] Add a calendar event (try a recurring one too)
- [ ] Add a chore and mark it done
- [ ] Add a shopping list item
- [ ] Write a note
- [ ] Add an expense
- [ ] If you have kids/homeschool relevant to you: poke at the School module; if not, just look at what's there
- [ ] Install it as a PWA on your phone (Settings → your browser's "Add to Home Screen") and try one thing from your phone
- [ ] Invite a second person to your household, if you have someone to test with (spouse, roommate, etc.) — otherwise just look at Settings → Members and imagine doing it

**Tell us:**
- Which of these felt natural? Which felt like work?
- Anything you tried to do that you couldn't find a way to do?
- Any errors, blank screens, or things that looked broken?

## Phase 5 — Settings & module control

1. Look at Settings → Modules. Try turning something off, then back on.
2. Look at Settings → Members (roles, what an owner vs. member can do).
3. Look at your notification/push settings.

**Tell us:**
- Did you understand what each module toggle does before turning it off?
- Anything in Settings that felt hidden or hard to find?

## Phase 6 — Wrap-up

**Tell us:**
- If you were describing this to a friend, what would you say it's for?
- What's the one thing that would make you actually keep using this day-to-day?
- What's the one thing that would make you give up on it?
- Anything else — bugs, ideas, "why does it do that" moments — dump it all here.

---

## Feedback capture (internal — fill in after Kort responds)

| Phase | Issues found | Severity (blocker / annoying / cosmetic) | Fixed? |
|-------|--------------|-------------------------------------------|--------|
| 1 — Marketing | | | |
| 2 — Checkout | | | |
| 3 — Dashboard | | | |
| 4 — Core modules | | | |
| 5 — Settings | | | |
| 6 — Overall | | | |

Roll blockers into `.cursor/runbook/07_LAUNCH.md` before considering the beta a pass.
