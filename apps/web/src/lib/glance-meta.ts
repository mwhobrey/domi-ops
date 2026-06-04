export function formatChoreDueMeta(dueDate: string | null, today: string): string {
  if (!dueDate) return "No date";
  if (dueDate < today) return "Overdue";
  if (dueDate === today) return "Today";
  const d = new Date(dueDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function formatSchoolDueMeta(dueAt: string, overdue: boolean): string {
  if (overdue) return "Overdue";
  const d = new Date(dueAt);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "Today";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
