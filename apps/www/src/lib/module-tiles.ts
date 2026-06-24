import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Calendar,
  FolderOpen,
  Heart,
  ListChecks,
  NotebookPen,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import type { MarketingScreenshot } from "@whome/marketing-ui";
import { MARKETING_SCREENSHOTS } from "@whome/marketing-ui";

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

export const MODULE_TILES: ModuleTile[] = [
  {
    key: "school",
    title: "Homeschool LMS",
    description: "Classes, assignments, gradebook, and student progress beside chores and calendar.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.school,
  },
  {
    key: "calendar",
    title: "Calendar + Google sync",
    description: "Week view, recurring events, school overlays, and optional Google import.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.heroCalendarWeek,
  },
  {
    key: "drive",
    title: "Household Drive",
    description: "Files, folders, and links shared across school, notes, and notices.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.drive,
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
    kind: "icon",
    icon: ShoppingCart,
  },
  {
    key: "expenses",
    title: "Expenses & budgets",
    description: "Monthly budgets, spend alerts, and household expense reports.",
    kind: "icon",
    icon: Receipt,
  },
  {
    key: "health",
    title: "Health tracker",
    description: "Encrypted meds and events with calendar overlays and reminders.",
    kind: "icon",
    icon: Heart,
  },
  {
    key: "notes",
    title: "Notes",
    description: "Markdown notes with pins, tags, sharing, and Drive embeds.",
    kind: "icon",
    icon: NotebookPen,
  },
];

export const ALSO_STRIP_ICONS = [BookOpen, Calendar, ListChecks] as const;
