export type GlanceTone = "default" | "warning" | "success";

export type NoteGlanceRow = { id: string; title: string; pinned: boolean };

/** Same "pinned first, then recent" shape as drive-glance.ts — notes and Drive files are the
 *  two modules where "what's pinned" is a more useful glance than "what's overdue". */
export function buildNotesGlance(rows: NoteGlanceRow[]) {
  const pinnedCount = rows.filter((r) => r.pinned).length;
  const items = rows.slice(0, 3).map((r) => ({ id: r.id, title: r.title, pinned: r.pinned }));
  const overflow = Math.max(0, rows.length - 3);

  let headline: string;
  let tone: GlanceTone;
  if (rows.length === 0) {
    headline = "No notes yet";
    tone = "success";
  } else if (pinnedCount > 0) {
    headline = `${pinnedCount} pinned`;
    tone = "default";
  } else {
    headline = "Recent notes";
    tone = "default";
  }

  return { summary: { headline, tone }, items, overflow };
}
