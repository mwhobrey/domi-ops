import { MARKETING_SCREENSHOTS } from "@domi-ops/marketing-ui";
import { AudiencePage } from "@/components/AudiencePage";
import { FAQ_ITEMS } from "@/lib/faq";

export const metadata = {
  title: "Homeschool gradebook and family planner | Domi Ops",
  description:
    "Classes, weighted gradebook, school days and hours logs, printable transcripts with your own grade scale, alongside your family calendar and chores. Self-host free or hosted.",
  alternates: { canonical: "/homeschool" },
};

// Reads NEXT_PUBLIC_* env vars at render time; see app/page.tsx.
export const dynamic = "force-dynamic";

const FAQ_KEYS = [
  "Can my kids have their own logins?",
  "Does it track attendance, hours, or produce transcripts?",
  "Can I use my own grading scale?",
  "Which homeschool curriculum does it work with?",
  "Can I use it without the homeschool stuff?",
];

export default function HomeschoolPage() {
  return (
    <AudiencePage
      eyebrow="For homeschool families"
      headline={
        <>
          Your homeschool and your household, <span className="text-gradient">in one place</span>
        </>
      }
      lead="Plan classes, hand out assignments, grade the work, and watch the year add up, right next to the calendar and chores that keep the rest of the house running."
      hero={{
        shot: MARKETING_SCREENSHOTS.schoolGradebook,
        alt: "Domi Ops gradebook showing grades by class and category",
      }}
      pillars={[
        {
          title: "Parent and student views",
          body: "Each kid logs in and sees their own assignments and grades. You see the whole class, grade the work, and leave feedback.",
        },
        {
          title: "A gradebook that follows your rules",
          body: "Weighted categories for tests, homework, and projects, tracked across the whole year.",
        },
        {
          title: "Tests that grade themselves",
          body: "Build a test in the app, students take it there, and scores land in the gradebook. Override any answer you disagree with.",
        },
        {
          title: "School days, not roll call",
          body: "Homeschool doesn't take attendance, so we don't ask for it. Tap the days school happened, for one kid or all of them, and set a goal like 180 days to watch your progress. A day also counts when you log hours, and the hours log keeps totals by date range for whenever a state or umbrella school asks.",
        },
        {
          title: "Transcripts on your grading scale",
          body: "Print courses by term with credits, grades, GPA, days, and hours. Use a preset scale or set your own cutoffs, labels, and GPA points. The transcript says which scale it used.",
        },
        {
          title: "School fits into the week",
          body: "Assignments sit on the same calendar as everything else, and worksheets and finished work live in Household Drive with the class. Assign a Google Doc and each student gets their own copy; the original freezes at first submission.",
        },
      ]}
      gallery={[
        {
          shot: MARKETING_SCREENSHOTS.school,
          alt: "Domi Ops school module showing classes and assignments",
          caption: "Classes and assignments, with each student's status at a glance.",
        },
        {
          shot: MARKETING_SCREENSHOTS.heroCalendarWeek,
          alt: "Domi Ops calendar week view with school assignment overlays",
          caption: "Assignments sit on the family calendar next to everything else.",
        },
      ]}
      notYet={{
        title: "What to know",
        body: "State requirements vary, so check yours. Domi Ops keeps the records (days, hours, grades, transcripts); it doesn't file anything for you or replace your umbrella school. Transcripts are prepared by you, not official district documents, and GPA is unweighted (no honors or AP weighting).",
      }}
      faq={FAQ_ITEMS.filter((i) => FAQ_KEYS.includes(i.q))}
      closing={{
        title: "See it with a real-looking week",
        body: "The demo is a sample household with classes, grades, and a calendar already filled in. No setup, no card.",
      }}
    />
  );
}
