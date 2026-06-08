export type ChoreGlanceRow = {
  id: string;
  description: string;
  dueDate: string | null;
  done: boolean;
  priority?: number;
};

export type GlanceTone = "success" | "warning" | "default";

function priorityRank(priority: number | undefined): number {
  return priority ?? 0;
}

export function buildChoresGlance(rows: ChoreGlanceRow[], today: string) {
  const open = rows.filter((c) => !c.done);
  const overdue = open.filter((c) => c.dueDate && c.dueDate < today);
  const dueToday = open.filter((c) => c.dueDate === today);
  const other = open.filter((c) => !c.dueDate || c.dueDate > today);

  const sortChores = (a: ChoreGlanceRow, b: ChoreGlanceRow) => {
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  };

  overdue.sort(sortChores);
  dueToday.sort(sortChores);
  other.sort(sortChores);

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
