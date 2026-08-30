import type { LucideIcon } from "lucide-react";
import { Bell, CircleDot, Smartphone } from "lucide-react";
import type { MarketingScreenshot } from "@domi-ops/marketing-ui";
import { MARKETING_SCREENSHOTS } from "@domi-ops/marketing-ui";

export type ModuleTile =
  | {
      key: string;
      title: string;
      description: string;
      /** Bento sizing hint — "wide" spans 2 columns on desktop. Keep at most one or two "wide"
       *  tiles so the grid still reads as a grid, not a second hero. */
      span?: "wide";
      kind: "screenshot";
      shot: MarketingScreenshot;
    }
  | {
      key: string;
      title: string;
      description: string;
      span?: "wide";
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
    description:
      "The household's one shared week view. School overlays layer on top automatically, and Google import keeps outside calendars from becoming a second source of truth.",
    span: "wide",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.heroCalendarWeek,
  },
  {
    key: "chores",
    title: "Chores & karma",
    description: "Streaks that actually mean something, and quests worth redeeming.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.chores,
  },
  {
    key: "shopping",
    title: "Shopping lists",
    description: "Grouped by aisle. Recurring items refill themselves. Snap a receipt when you're done.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.shopping,
  },
  {
    key: "expenses",
    title: "Expenses & budgets",
    description:
      "Set a monthly number per category, get a nudge before you blow past it. Not a report a week later telling you what already happened.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.expenses,
  },
  {
    key: "notes",
    title: "Notes",
    description: "Markdown, pinned, tagged, and pulled straight into Drive when they need attachments.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.notes,
  },
  {
    key: "drive",
    title: "Household Drive",
    description: "Every file school, notes, and notices touch, in one folder tree instead of four.",
    kind: "screenshot",
    shot: MARKETING_SCREENSHOTS.drive,
  },
];

export const ALSO_STRIP_ITEMS = [
  { icon: CircleDot, label: "Presence" },
  { icon: Smartphone, label: "PWA" },
  { icon: Bell, label: "Push" },
] as const;
