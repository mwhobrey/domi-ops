export type ClassSchedule = {
  summary?: string;
  days?: string[];
  time?: string;
  location?: string;
};

export function parseClassSchedule(raw: string | null | undefined): ClassSchedule {
  if (!raw || raw === "{}") return {};
  try {
    const parsed = JSON.parse(raw) as ClassSchedule;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed;
  } catch {
    return { summary: raw };
  }
}

export function formatClassSchedule(raw: string | null | undefined): string | null {
  const schedule = parseClassSchedule(raw);
  if (schedule.summary?.trim()) return schedule.summary.trim();

  const parts: string[] = [];
  if (schedule.days?.length) parts.push(schedule.days.join(", "));
  if (schedule.time?.trim()) parts.push(schedule.time.trim());
  if (schedule.location?.trim()) parts.push(`@ ${schedule.location.trim()}`);

  const text = parts.join(" · ").trim();
  return text || null;
}

export function scheduleToJson(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return "{}";
  return JSON.stringify({ summary: trimmed } satisfies ClassSchedule);
}
