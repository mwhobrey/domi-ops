/** Calendar helpers for weekly report UI (mirrors @domi-ops/calendar-sync/household-time). */

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIsoLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function isoWeekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function mondayOfWeekIso(iso: string): string {
  const day = isoWeekday(iso);
  const offset = day === 0 ? -6 : 1 - day;
  return addDaysIso(iso, offset);
}

export function fridayOfWeekIso(mondayIso: string): string {
  return addDaysIso(mondayIso, 4);
}

/** Default range end: Friday of the 4th week starting at `fromMonday`. */
export function defaultRangeEnd(fromMonday: string): string {
  return addDaysIso(fromMonday, 25);
}

export function currentWeekMonday(): string {
  return mondayOfWeekIso(todayIsoLocal());
}

export type WeeklyScopeMode = "week" | "range";

export interface WeeklyScopeWeek {
  mode: "week";
  weekStart: string;
}

export interface WeeklyScopeRange {
  mode: "range";
  from: string;
  to: string;
}

export type WeeklyScope = WeeklyScopeWeek | WeeklyScopeRange;

export function scopeQueryParams(scope: WeeklyScope): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.mode === "week") {
    params.set("weekStart", scope.weekStart);
  } else {
    params.set("from", scope.from);
    params.set("to", scope.to);
  }
  return params;
}

export function exportScopeBody(scope: WeeklyScope): Record<string, string> {
  if (scope.mode === "week") return { weekStart: scope.weekStart };
  return { from: scope.from, to: scope.to };
}
