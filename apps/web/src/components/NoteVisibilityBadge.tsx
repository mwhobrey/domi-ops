import { Lock, Share2, Users } from "lucide-react";
import type { NoteVisibility } from "../lib/note-visibility";
import { noteVisibilityLabel } from "../lib/note-visibility";

export function NoteVisibilityBadge({
  visibility,
  sharedWithMe,
  sharedCount = 0,
}: {
  visibility: NoteVisibility;
  sharedWithMe?: boolean;
  sharedCount?: number;
}) {
  const label = noteVisibilityLabel(visibility, { sharedWithMe, sharedCount });
  const Icon =
    sharedWithMe || (visibility === "private" && sharedCount > 0)
      ? Share2
      : visibility === "private"
        ? Lock
        : Users;

  return (
    <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  );
}
