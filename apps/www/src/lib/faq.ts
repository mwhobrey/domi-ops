export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Is self-hosting actually free, or is there a catch?",
    a: "Free, MIT license, every module included. There's no feature gate pushing you toward the paid tier. You run it on your own server with Docker Compose and your own Postgres.",
  },
  {
    q: "What's the real difference between self-host and Domi Ops Cloud?",
    a: "Same app either way. Self-host means you manage the server, the database, and backups. Cloud means we do, on shared infrastructure, for $12/mo (or $120/yr). Pick based on whether you already run a server, not on features.",
  },
  {
    q: "Do you sell or share my data?",
    a: "We do not sell household data. Cloud uses service providers for hosting, storage, transactional email, payments and configured error diagnostics. Optional connections such as Google and Withings exchange the data needed for the feature you enable. Self-host operators choose and configure their own services. See the privacy policy for processors, access and retention details.",
  },
  {
    q: "Is the health module HIPAA-compliant?",
    a: "No, and it's not trying to be. It's a household tool, not a medical record system. Sensitive fields (medication names, dosage, notes) are encrypted at rest, but Domi Ops isn't a healthcare provider and makes no HIPAA claims.",
  },
  {
    q: "Does Domi Ops work with MyAllyFile?",
    a: "Yes, on Domi Ops Cloud. MyAllyFile is a separate emergency medical profile that first responders open with a QR code and PIN. Link a household member to their MyAllyFile profile and all of their current medications are copied across whenever they change, so the emergency profile doesn't go stale. It only goes one way, from Domi Ops to MyAllyFile, and nothing is read back. Unlinking removes the synced medications from the profile. Linking needs a MyAllyFile Plus or Pro plan.",
  },
  {
    q: "Can it remind someone to take blood pressure or weight readings?",
    a: "Yes. Scheduled health checks work like medication reminders, but for measurements: set a check for a person (say, blood pressure four times a day), and Domi Ops sends a push reminder at each time. If the reading is already logged, no reminder goes out. You can bundle several checks into one reminder, skip a check right from the notification, and see adherence and blood pressure reports for date ranges of up to a year. With a Withings cuff the readings can arrive on their own, so a check fills in without anyone typing a number.",
  },
  {
    q: "Does it work with a Withings blood pressure cuff?",
    a: "Yes. Connect a person's Withings account from Health and choose the history period to import. Supported data includes blood pressure and pulse, blood oxygen, body temperature, workouts, daily steps/distance/active minutes/calories, and sleep timing, stages, awakenings and score when your devices provide them. Suitable readings can fill scheduled health checks. Domi Ops reads records and registers update notifications; it does not edit your Withings health records. Activity and sleep summaries can update as the source changes. Disconnecting stops future imports and keeps existing Domi Ops records until you delete them. Some Withings accounts need Withings+ for API sharing under Withings' current plan rules; that membership is separate from Domi Ops. Self-host operators register their own Withings developer app. This is a household tool, not a medical device.",
  },
  {
    q: "Can it help me fill a pill organizer and remember refills?",
    a: "Yes. Set up a pill organizer for a person: how often you fill it, how many days it holds, and which compartment each dose time goes in (Morning, Lunch, Supper, Night, or your own). Then a filling session follows you through the bottles: pick a medication, see which pills go in which compartment and how many, save it, and move on. If you run short you can fill fewer days now and the rest later. Domi Ops reminds you on fill day and when a refill is due, and you mark a refill requested and then received. Filling never marks doses as taken.",
  },
  {
    q: "Does it know how many pills are left?",
    a: "No, and it says so. Supply is an estimate that you confirm, not a live count. You tell it how many days of a medication you keep outside the organizer, and it adds the days the organizer still holds to work out when you run out. Taking or skipping a dose never changes it, so if you take extra or skip some, update it. After a medication is paused and resumed, Domi Ops asks you to confirm the estimate before it reminds you again.",
  },
  {
    q: "Who can see and edit a family member's health records?",
    a: "You choose. Each record is private or shared with the household, and sharing is read-only by default. Editing needs the creator, the person the record is about, an owner or admin, or someone you've explicitly granted write access.",
  },
  {
    q: "Can I use it without the homeschool stuff?",
    a: "Yes. School is included and enabled when a hosted household is created, but an owner or admin can turn it off in Settings. Calendar, chores and the other enabled modules remain available. Self-host defaults depend on the operator's configuration.",
  },
  {
    q: "Can my kids have their own logins?",
    a: "Yes. Members have roles (owner, admin, member, child, guest). In School, students see their own assignments and grades while parents see and grade everything.",
  },
  {
    q: "Does it track attendance, hours, or produce transcripts?",
    a: "Yes, built for how homeschooling works. There's no roll call: you tap the days school happened on a calendar, and a day also counts on its own when you log hours. Set a days-of-instruction target (like 180) and watch your progress. Log instruction hours as you go, then print a transcript with courses by term, credits, grades, GPA, days, and hours. Requirements differ by state, so check yours. The transcript is prepared by you, not an official district document.",
  },
  {
    q: "Can I use my own grading scale?",
    a: "Yes. There's no universal scale, so pick a preset (plain A-F, plus/minus, or 7-point) or set your own cutoffs, grade labels, GPA points, and the percent that earns credit. The transcript prints the scale it used. GPA is unweighted, with no honors or AP weighting.",
  },
  {
    q: "Which homeschool curriculum does it work with?",
    a: "Domi Ops is a place to plan, assign, and record, not a curriculum. Bring whatever you teach with. You can attach materials from Drive or Google Docs, build tests in the app, and track everything in one gradebook.",
  },
  {
    q: "What happens to my data if I cancel Cloud?",
    a: "Cancel renewal in household Settings; store subscriptions are managed through the store. Scheduled cancellation keeps paid access through the current period. When the subscription ends, you can still read and export records your permissions allow, while changes and background jobs pause. Cancellation does not itself delete household data. See the privacy policy or contact privacy@domi-ops.com to request household deletion.",
  },
  {
    q: "Does it work on my phone?",
    a: "Yes, install Domi Ops from your browser as a web app. On iPhone and iPad, add it to your Home Screen and open that installed app before enabling notifications. Push needs your permission and a supported browser/device; delivery also depends on device and network settings. See Profile to enable notifications on each device.",
  },
  {
    q: "Can I try it before setting anything up?",
    a: "Yes, the demo is a live sandbox seeded with a sample household. Poke around before you decide which path to take.",
  },
];

/** schema.org FAQPage JSON-LD for a set of questions. */
export function faqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
}

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://domi-ops.com").replace(/\/$/, "");
