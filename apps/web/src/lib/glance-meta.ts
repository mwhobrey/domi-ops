import { formatDateLocal } from "./calendar-utils";

/** Chore list due label: "Due today", "Due tomorrow", "Due Fri, Sep 25", "Overdue · Tue, Jul 7". */
export function formatChoreDueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return "Due today";
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dueDate === formatDateLocal(tomorrow)) return "Due tomorrow";
  const label = new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(dueDate.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" as const } : {}),
  });
  return dueDate < today ? `Overdue · ${label}` : `Due ${label}`;
}

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
