import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthWithingsSleep } from "@domi-ops/db";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { aclLevelAtLeast, loadHealthAclBySubjectForGrantee, visibilityGrantsForSubject } from "./health-access.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";

type SleepRow = typeof healthWithingsSleep.$inferSelect;

export type SleepTrendPoint = {
  date: string;
  totalMinutes: number;
  inBedMinutes: number | null;
  lightMinutes: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  awakeMinutes: number | null;
  score: number | null;
};

export type SleepTrendEntry = {
  memberId: string;
  memberLabel: string;
  points: SleepTrendPoint[];
};

const toNum = (value: string | null, env: Env): number | null => {
  const text = decryptHealthFieldOrPassthrough(value, env);
  if (text == null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/**
 * One night per (member, date). Withings can hold several series for one date (a watch and a sleep mat, or a nap
 * logged beside the night); adding them would invent hours nobody slept, so the date shows its longest sleep.
 */
export function buildSleepTrend(rows: SleepRow[], memberLabel: Map<string, string>, env: Env): SleepTrendEntry[] {
  const best = new Map<string, { row: SleepRow; total: number }>();
  for (const row of rows) {
    const total = toNum(row.totalSleepMinutes, env);
    if (total == null) continue;
    const key = `${row.memberId}::${row.date}`;
    const held = best.get(key);
    if (!held || total > held.total) best.set(key, { row, total });
  }

  const byMember = new Map<string, SleepTrendPoint[]>();
  for (const { row, total } of best.values()) {
    const point: SleepTrendPoint = {
      date: row.date,
      totalMinutes: total,
      inBedMinutes: toNum(row.inBedMinutes, env),
      lightMinutes: toNum(row.lightMinutes, env),
      deepMinutes: toNum(row.deepMinutes, env),
      remMinutes: toNum(row.remMinutes, env),
      awakeMinutes: toNum(row.awakeMinutes, env),
      score: toNum(row.sleepScore, env),
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

/** Sleep for the report. Same rule as daily activity: your own, and anyone's you hold an `events` grant on. */
export async function loadSleepTrend(
  db: Database,
  env: Env,
  auth: { householdId: string; memberId: string },
  range: { from: string; to: string },
  memberLabel: Map<string, string>,
  memberFilter: string | null,
): Promise<SleepTrendEntry[]> {
  const acl = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  let visible = [...memberLabel.keys()].filter(
    (id) => id === auth.memberId || aclLevelAtLeast(visibilityGrantsForSubject(acl, id).events, "read"),
  );
  if (memberFilter) visible = visible.filter((id) => id === memberFilter);
  if (visible.length === 0) return [];
  const rows = await db
    .select()
    .from(healthWithingsSleep)
    .where(
      and(
        eq(healthWithingsSleep.householdId, auth.householdId),
        inArray(healthWithingsSleep.memberId, visible),
        gte(healthWithingsSleep.date, range.from),
        lte(healthWithingsSleep.date, range.to),
      ),
    )
    .orderBy(asc(healthWithingsSleep.date));
  return buildSleepTrend(rows, memberLabel, env);
}
