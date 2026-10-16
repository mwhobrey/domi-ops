import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthWithingsDailyActivity } from "@domi-ops/db";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { aclLevelAtLeast, loadHealthAclBySubjectForGrantee, visibilityGrantsForSubject } from "./health-access.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";

type ActivityRow = typeof healthWithingsDailyActivity.$inferSelect;

export type ActivityTrendPoint = {
  date: string;
  steps: number;
  distanceKm: number | null;
  activeMinutes: number | null;
  caloriesActive: number | null;
};

export type ActivityTrendEntry = {
  memberId: string;
  memberLabel: string;
  points: ActivityTrendPoint[];
};

const toNum = (value: string | null, env: Env): number | null => {
  const text = decryptHealthFieldOrPassthrough(value, env);
  if (text == null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/**
 * One row per (member, date) out of the per-device rows Withings gives. A phone and a watch can both report
 * a day; counting both would double the steps, so the day is the tracker's when there is one, and then the
 * device that saw the most steps. Pure apart from decryption.
 */
export function buildActivityTrend(
  rows: ActivityRow[],
  memberLabel: Map<string, string>,
  env: Env,
): ActivityTrendEntry[] {
  const best = new Map<string, { row: ActivityRow; steps: number }>();
  for (const row of rows) {
    const steps = toNum(row.steps, env);
    if (steps == null) continue;
    const key = `${row.memberId}::${row.date}`;
    const held = best.get(key);
    const better =
      !held ||
      (row.isTracker && !held.row.isTracker) ||
      (row.isTracker === held.row.isTracker && steps > held.steps);
    if (better) best.set(key, { row, steps });
  }

  const byMember = new Map<string, ActivityTrendPoint[]>();
  for (const { row, steps } of best.values()) {
    const distanceM = toNum(row.distanceM, env);
    const point: ActivityTrendPoint = {
      date: row.date,
      steps,
      distanceKm: distanceM == null ? null : Math.round(distanceM / 10) / 100,
      activeMinutes: toNum(row.activeMinutes, env),
      caloriesActive: toNum(row.caloriesActive, env),
    };
    byMember.set(row.memberId, [...(byMember.get(row.memberId) ?? []), point]);
  }

  return [...byMember.entries()]
    .map(([memberId, points]) => ({
      memberId,
      memberLabel: memberLabel.get(memberId) ?? "Member",
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => a.memberLabel.localeCompare(b.memberLabel));
}

/**
 * Daily activity for the report. The viewer sees their own, and anyone's they hold an `events` grant on,
 * which is how their imported entries are shared (the same rule as the rest of the health report).
 */
export async function loadActivityTrend(
  db: Database,
  env: Env,
  auth: { householdId: string; memberId: string },
  range: { from: string; to: string },
  memberLabel: Map<string, string>,
  memberFilter: string | null,
): Promise<ActivityTrendEntry[]> {
  const acl = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  let visible = [...memberLabel.keys()].filter(
    (id) => id === auth.memberId || aclLevelAtLeast(visibilityGrantsForSubject(acl, id).events, "read"),
  );
  if (memberFilter) visible = visible.filter((id) => id === memberFilter);
  if (visible.length === 0) return [];
  const rows = await db
    .select()
    .from(healthWithingsDailyActivity)
    .where(
      and(
        eq(healthWithingsDailyActivity.householdId, auth.householdId),
        inArray(healthWithingsDailyActivity.memberId, visible),
        gte(healthWithingsDailyActivity.date, range.from),
        lte(healthWithingsDailyActivity.date, range.to),
      ),
    )
    .orderBy(asc(healthWithingsDailyActivity.date));
  return buildActivityTrend(rows, memberLabel, env);
}
