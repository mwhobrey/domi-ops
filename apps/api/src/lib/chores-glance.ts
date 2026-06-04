export type ChoreGlanceRow = {
  id: string;
  description: string;
  dueDate: string | null;
  done: boolean;
};

export type GlanceTone = "success" | "warning" | "default";

export function buildChoresGlance(rows: ChoreGlanceRow[], today: string) {
  const open = rows.filter((c) => !c.done);
  const overdue = open.filter((c) => c.dueDate && c.dueDate < today);
  const dueToday = open.filter((c) => c.dueDate === today);
  const other = open.filter((c) => !c.dueDate || (c.dueDate > today));

  other.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const ordered = [...overdue, ...dueToday, ...other];
  const previewLimit = 4;
  const items = ordered.slice(0, previewLimit).map((c) => ({
    id: c.id,
    description: c.description,
    dueDate: c.dueDate,
  }));
  const overflow = Math.max(0, ordered.length - 3);

  let headline: string;
  let tone: GlanceTone = "default";
  if (open.length === 0) {
    headline = "All done";
    tone = "success";
  } else if (overdue.length > 0) {
    headline = `${overdue.length} overdue`;
    tone = "warning";
  } else if (dueToday.length > 0) {
    headline = `${dueToday.length} due today`;
  } else {
    headline = `${open.length} remaining`;
  }

  return {
    summary: {
      open: open.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      tone,
      headline,
    },
    items,
    overflow,
  };
}
