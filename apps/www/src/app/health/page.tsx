import { MARKETING_SCREENSHOTS } from "@domi-ops/marketing-ui";
import { AudiencePage } from "@/components/AudiencePage";
import { FAQ_ITEMS } from "@/lib/faq";
import { pageSocial } from "@/lib/og";

const TITLE = "Family medication and health tracker | Domi Ops";
const DESCRIPTION =
  "Grouped medication reminders, dose history, appointments, and vitals for everyone in your household. Encrypted at rest, shared only with who you choose.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/health" },
  ...pageSocial({ title: TITLE, description: DESCRIPTION, path: "/health", image: "health" }),
};

// Reads NEXT_PUBLIC_* env vars at render time; see app/page.tsx.
export const dynamic = "force-dynamic";

const FAQ_KEYS = [
  "Is the health module HIPAA-compliant?",
  "Does Domi Ops work with MyAllyFile?",
  "Who can see and edit a family member's health records?",
  "Do you sell or share my data?",
  "What happens to my data if I cancel Cloud?",
];

export default function HealthPage() {
  return (
    <AudiencePage
      eyebrow="Family health"
      headline={
        <>
          Everyone&apos;s medications and appointments, <span className="text-gradient">handled</span>
        </>
      }
      lead="One reminder for the pill organizer instead of five pings for five pills. Doses, appointments, and vitals for every member of the household, shared only with the people you choose."
      hero={{
        shot: MARKETING_SCREENSHOTS.health,
        alt: "Domi Ops health module showing medications, events, and vitals",
      }}
      pillars={[
        {
          title: "Doses grouped, not spammed",
          body: "Medications taken together get one reminder and a Take all button, so nobody's phone lights up five times before breakfast.",
        },
        {
          title: "Pause it, or fix it later",
          body: "Stopping a medication keeps its settings and dose history, and paused meds send no reminders. Adherence reports skip the paused days instead of counting them as missed. Forgot to tap Taken? Edit the dose and set when it was really taken. Interval medications recalculate the next dose from the corrected time.",
        },
        {
          title: "Encrypted, and shared on purpose",
          body: "Medication names, doses, and notes are encrypted at rest. Each record is private or shared, and seeing a record never lets someone edit it.",
        },
        {
          title: "Keeps an emergency profile current",
          body: "Link a member to their MyAllyFile profile and their current medications are copied there whenever they change, so the QR code on the fridge or the keychain never lists last month's pills. It only goes one way, you link it on purpose from Settings, and it needs a MyAllyFile Plus or Pro plan.",
        },
        {
          title: "On the household calendar",
          body: "Appointments and medication times appear next to everything else, so a doctor's visit doesn't collide with a co-op day. Track parents, kids, and grandparents in one place, each with their own records and sharing.",
        },
      ]}
      gallery={[
        {
          shot: MARKETING_SCREENSHOTS.health,
          alt: "Domi Ops health module Today view",
          caption: "Today's doses, grouped by when they're taken.",
        },
        {
          shot: MARKETING_SCREENSHOTS.dashboard,
          alt: "Domi Ops dashboard with today at a glance",
          caption: "Health sits on the same dashboard as school and the calendar.",
        },
      ]}
      notYet={{
        title: "What this is, and isn't",
        body: "Domi Ops is a household tool, not a medical record system. It isn't a healthcare provider and makes no HIPAA claims. It doesn't replace your doctor's or pharmacy's records; it helps your family remember, share, and keep track.",
      }}
      faq={FAQ_ITEMS.filter((i) => FAQ_KEYS.includes(i.q))}
      closing={{
        title: "Look around with sample data",
        body: "The demo household has medications and appointments already in it. No setup, no card.",
      }}
    />
  );
}
