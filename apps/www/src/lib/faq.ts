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
    a: "No. Self-hosted, your data stays on your server unless you turn on an integration such as Google sync, and we don't have access to your server. On Cloud, it stays in your household's isolated data, and it's never sold to anyone, for any reason.",
  },
  {
    q: "Is the health module HIPAA-compliant?",
    a: "No, and it's not trying to be. It's a household tool, not a medical record system. Sensitive fields (medication names, dosage, notes) are encrypted at rest, but Domi Ops isn't a healthcare provider and makes no HIPAA claims.",
  },
  {
    q: "Who can see and edit a family member's health records?",
    a: "You choose. Each record is private or shared with the household, and sharing is read-only by default. Editing needs the creator, the person the record is about, an owner or admin, or someone you've explicitly granted write access.",
  },
  {
    q: "Can I use it without the homeschool stuff?",
    a: "Yes. School is one module among several, off by default until you turn it on. Calendar and chores work fine as a standalone family organizer.",
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
    a: "Email us and we delete or anonymize it within a reasonable time, unless we're legally required to hold onto something. There's no lock-in trick where canceling strands your calendar.",
  },
  {
    q: "Does it work on my phone?",
    a: "It's a PWA: install it from the browser on iOS or Android and it behaves like a native app, including push notifications for reminders.",
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
