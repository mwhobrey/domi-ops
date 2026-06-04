/** DB `calendar_visibility` values */
export type CalendarVisibilityDb = "household" | "private";

/** UI control values for the calendars settings panel */
export type CalendarAccessMode = "public" | "private" | "shared";

export function calendarAccessMode(
  visibility: CalendarVisibilityDb,
  shareCount: number,
): CalendarAccessMode {
  if (visibility === "household") return "public";
  if (shareCount > 0) return "shared";
  return "private";
}

export function calendarAccessLabel(
  visibility: CalendarVisibilityDb,
  shareCount: number,
): string {
  const mode = calendarAccessMode(visibility, shareCount);
  if (mode === "public") return "Public";
  if (mode === "shared") return shareCount === 1 ? "Shared · 1 member" : `Shared · ${shareCount} members`;
  return "Private";
}

export const CALENDAR_ACCESS_OPTIONS: {
  value: CalendarAccessMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "public",
    label: "Public",
    hint: "Visible to everyone in the household",
  },
  {
    value: "private",
    label: "Private",
    hint: "Only you — not listed for other members",
  },
  {
    value: "shared",
    label: "Shared",
    hint: "Only you plus members you pick below",
  },
];
