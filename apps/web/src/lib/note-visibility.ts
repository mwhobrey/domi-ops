export type NoteVisibility = "private" | "household";

export const NOTE_VISIBILITY_OPTIONS: {
  value: NoteVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: "household",
    label: "Household",
    description: "Everyone in your household can see this note",
  },
  {
    value: "private",
    label: "Private",
    description: "Only you can see this note unless you share it with specific members",
  },
];

export function noteVisibilityLabel(
  visibility: NoteVisibility,
  opts?: {
    sharedWithMe?: boolean;
    sharedCount?: number;
  },
): string {
  if (opts?.sharedWithMe) return "Shared with you";
  if (visibility === "private") {
    const count = opts?.sharedCount ?? 0;
    if (count > 0) {
      return count === 1 ? "Private · shared with 1 member" : `Private · shared with ${count} members`;
    }
    return "Private note";
  }
  return "Household note";
}
