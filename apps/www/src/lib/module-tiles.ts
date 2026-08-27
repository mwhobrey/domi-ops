import type { LucideIcon } from "lucide-react";
import { BookOpen, Calendar, ListChecks } from "lucide-react";
import type { MarketingScreenshot } from "@domi-ops/marketing-ui";
import { MARKETING_SCREENSHOTS } from "@domi-ops/marketing-ui";

export type ModuleTile =
  | {
      key: string;
      title: string;
      description: string;
      kind: "screenshot";
      shot: MarketingScreenshot;
    }
  | {
      key: string;
      title: string;
      description: string;
      kind: "icon";
      icon: LucideIcon;
    };

/**
 * The "everything else, included" grid — completeness proof, not the headline pitch.
 * School and Health get their own dedicated narrative section above this (LandingPage.tsx,
 * "why Domi Ops" callout) instead of a tile here, so they aren't shown twice.
 */
export const MODULE_TILES: ModuleTile[] = [
  {
    key: "calendar",
    title: "Calendar + Google sync",
    description: "Week view, recurring events, school overlays, and optional Google import.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.heroCalendarWeek,
  },
  {
    key: "chores",
    title: "Chores & karma",
    description: "Assignments, streaks, and redemption quests for the whole household.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.chores,
  },
  {
    key: "shopping",
    title: "Shopping lists",
    description: "Aisle grouping, recurring items, and trip history with optional receipt capture.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.shopping,
  },
  {
    key: "drive",
    title: "Household Drive",
    description: "Files, folders, and links shared across school, notes, and notices.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.drive,
  },
  {
    key: "expenses",
    title: "Expenses & budgets",
    description: "Monthly budgets, spend alerts, and household expense reports.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.expenses,
  },
  {
    key: "notes",
    title: "Notes",
    description: "Markdown notes with pins, tags, sharing, and Drive embeds.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.notes,
  },
];

export const ALSO_STRIP_ICONS = [BookOpen, Calendar, ListChecks] as const;
