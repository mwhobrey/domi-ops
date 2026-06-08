import type { Database } from "@whome/db";
import {
  choreCompletions,
  choreMemberKarma,
  householdMembers,
  users,
  type chores as choresTable,
} from "@whome/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { ChorePriority } from "./chores.js";
import { todayIsoDate } from "./shopping.js";

export type ChoreCompletionTiming = "on_time" | "early" | "late" | "no_due" | "redemption";

export interface ChoreCompletionResult {
  karmaEarned: number;
  timing: ChoreCompletionTiming;
  daysLate: number | null;
  streakBonus: number;
  currentStreak: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00.000Z`);
  const to = new Date(`${toIso}T12:00:00.000Z`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function computeChoreCompletion(
  priority: ChorePriority,
  dueDate: string | null | undefined,
  completedAt: Date = new Date(),
): Pick<ChoreCompletionResult, "karmaEarned" | "timing" | "daysLate"> {
  const completedDay = completedAt.toISOString().slice(0, 10);
  const baseKarma = 10 + priority * 5;

  if (!dueDate) {
    return { karmaEarned: baseKarma, timing: "no_due", daysLate: null };
  }

  if (completedDay < dueDate) {
    return { karmaEarned: baseKarma + 7, timing: "early", daysLate: 0 };
  }
  if (completedDay === dueDate) {
    return { karmaEarned: baseKarma + 5, timing: "on_time", daysLate: 0 };
  }

  const daysLate = daysBetween(dueDate, completedDay);
  return { karmaEarned: baseKarma + 3, timing: "redemption", daysLate };
}

function yesterdayIso(fromIso: string): string {
  const d = new Date(`${fromIso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function streakBonusFor(streak: number): number {
  return Math.min(5, Math.max(0, streak - 1));
}

export async function recordChoreCompletion(
  db: Database,
  input: {
    householdId: string;
    chore: typeof choresTable.$inferSelect;
    completedByMemberId: string;
  },
): Promise<ChoreCompletionResult> {
  const completedAt = new Date();
  const completedDay = completedAt.toISOString().slice(0, 10);
  const memberId = input.chore.assigneeMemberId ?? input.completedByMemberId;
  const priority = (input.chore.priority ?? 0) as ChorePriority;
  const { karmaEarned: baseKarma, timing, daysLate } = computeChoreCompletion(
    priority,
    input.chore.dueDate,
    completedAt,
  );

  const [existingKarma] = await db
    .select()
    .from(choreMemberKarma)
    .where(
      and(
        eq(choreMemberKarma.householdId, input.householdId),
        eq(choreMemberKarma.memberId, memberId),
      ),
    )
    .limit(1);

  let currentStreak = 1;
  if (existingKarma?.lastCompletionDate) {
    if (existingKarma.lastCompletionDate === completedDay) {
      currentStreak = existingKarma.currentStreak;
    } else if (existingKarma.lastCompletionDate === yesterdayIso(completedDay)) {
      currentStreak = existingKarma.currentStreak + 1;
    }
  }

  const streakBonus = streakBonusFor(currentStreak);
  const totalKarma = baseKarma + streakBonus;
  const bestStreak = Math.max(existingKarma?.bestStreak ?? 0, currentStreak);
  const redemptionIncrement = timing === "redemption" ? 1 : 0;

  await db.insert(choreCompletions).values({
    householdId: input.householdId,
    choreId: input.chore.id,
    memberId,
    description: input.chore.description,
    dueDate: input.chore.dueDate,
    completedAt,
    karmaEarned: totalKarma,
    timing,
    daysLate,
  });

  await db
    .insert(choreMemberKarma)
    .values({
      householdId: input.householdId,
      memberId,
      karmaPoints: totalKarma,
      currentStreak,
      bestStreak,
      redemptionQuestsCompleted: redemptionIncrement,
      lastCompletionDate: completedDay,
    })
    .onConflictDoUpdate({
      target: [choreMemberKarma.householdId, choreMemberKarma.memberId],
      set: {
        karmaPoints: sql`${choreMemberKarma.karmaPoints} + ${totalKarma}`,
        currentStreak,
        bestStreak,
        redemptionQuestsCompleted: sql`${choreMemberKarma.redemptionQuestsCompleted} + ${redemptionIncrement}`,
        lastCompletionDate: completedDay,
      },
    });

  return {
    karmaEarned: totalKarma,
    timing,
    daysLate,
    streakBonus,
    currentStreak,
  };
}

export function serializeMemberKarma(
  row: typeof choreMemberKarma.$inferSelect,
  label: string,
) {
  return {
    memberId: row.memberId,
    label,
    karmaPoints: row.karmaPoints,
    currentStreak: row.currentStreak,
    bestStreak: row.bestStreak,
    redemptionQuestsCompleted: row.redemptionQuestsCompleted,
  };
}

export async function loadHouseholdKarma(db: Database, householdId: string) {
  const rows = await db
    .select({
      karma: choreMemberKarma,
      name: users.displayName,
      username: users.username,
      email: users.email,
    })
    .from(choreMemberKarma)
    .innerJoin(householdMembers, eq(choreMemberKarma.memberId, householdMembers.id))
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(choreMemberKarma.householdId, householdId))
    .orderBy(sql`${choreMemberKarma.karmaPoints} desc`);

  return rows.map((r) =>
    serializeMemberKarma(
      r.karma,
      r.name?.trim() || r.username || r.email || "Member",
    ),
  );
}

export interface ChoreMemberReportRow {
  memberId: string;
  label: string;
  totalCompletions: number;
  onTimeCount: number;
  earlyCount: number;
  redemptionCount: number;
  noDueCount: number;
  avgDaysLate: number | null;
  karmaEarned: number;
  delayBuckets: {
    sameDay: number;
    oneToThree: number;
    fourToSeven: number;
    overSeven: number;
  };
}

export interface ChoreReportsData {
  from: string;
  to: string;
  summary: {
    totalCompletions: number;
    onTimeCount: number;
    earlyCount: number;
    redemptionCount: number;
    noDueCount: number;
    avgDaysLate: number | null;
  };
  byMember: ChoreMemberReportRow[];
}

function delayBucket(daysLate: number | null): keyof ChoreMemberReportRow["delayBuckets"] | null {
  if (daysLate == null || daysLate <= 0) return "sameDay";
  if (daysLate <= 3) return "oneToThree";
  if (daysLate <= 7) return "fourToSeven";
  return "overSeven";
}

export async function buildChoreReports(
  db: Database,
  householdId: string,
  from: string,
  to: string,
): Promise<ChoreReportsData> {
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const toTs = new Date(`${to}T23:59:59.999Z`);

  const completions = await db
    .select({
      completion: choreCompletions,
      name: users.displayName,
      username: users.username,
      email: users.email,
    })
    .from(choreCompletions)
    .leftJoin(householdMembers, eq(choreCompletions.memberId, householdMembers.id))
    .leftJoin(users, eq(householdMembers.userId, users.id))
    .where(
      and(
        eq(choreCompletions.householdId, householdId),
        gte(choreCompletions.completedAt, fromTs),
        lte(choreCompletions.completedAt, toTs),
      ),
    );

  const memberMap = new Map<string, ChoreMemberReportRow>();

  for (const row of completions) {
    const c = row.completion;
    const memberId = c.memberId ?? "unassigned";
    const label =
      memberId === "unassigned"
        ? "Unassigned"
        : row.name?.trim() || row.username || row.email || "Member";

    let entry = memberMap.get(memberId);
    if (!entry) {
      entry = {
        memberId,
        label,
        totalCompletions: 0,
        onTimeCount: 0,
        earlyCount: 0,
        redemptionCount: 0,
        noDueCount: 0,
        avgDaysLate: null,
        karmaEarned: 0,
        delayBuckets: { sameDay: 0, oneToThree: 0, fourToSeven: 0, overSeven: 0 },
      };
      memberMap.set(memberId, entry);
    }

    entry.totalCompletions += 1;
    entry.karmaEarned += c.karmaEarned;

    if (c.timing === "on_time") entry.onTimeCount += 1;
    else if (c.timing === "early") entry.earlyCount += 1;
    else if (c.timing === "redemption") entry.redemptionCount += 1;
    else if (c.timing === "no_due") entry.noDueCount += 1;

    const bucket = delayBucket(c.daysLate);
    if (bucket) entry.delayBuckets[bucket] += 1;
  }

  const byMember = [...memberMap.values()].sort((a, b) =>
    b.totalCompletions - a.totalCompletions,
  );

  for (const entry of byMember) {
    const lateDays = completions
      .filter((r) => (r.completion.memberId ?? "unassigned") === entry.memberId)
      .map((r) => r.completion.daysLate)
      .filter((d): d is number => d != null && d > 0);
    entry.avgDaysLate =
      lateDays.length > 0
        ? Math.round((lateDays.reduce((a, b) => a + b, 0) / lateDays.length) * 10) / 10
        : null;
  }

  const summary = byMember.reduce(
    (acc, m) => ({
      totalCompletions: acc.totalCompletions + m.totalCompletions,
      onTimeCount: acc.onTimeCount + m.onTimeCount,
      earlyCount: acc.earlyCount + m.earlyCount,
      redemptionCount: acc.redemptionCount + m.redemptionCount,
      noDueCount: acc.noDueCount + m.noDueCount,
      avgDaysLate: null as number | null,
    }),
    {
      totalCompletions: 0,
      onTimeCount: 0,
      earlyCount: 0,
      redemptionCount: 0,
      noDueCount: 0,
      avgDaysLate: null as number | null,
    },
  );

  const allLateDays = completions
    .map((r) => r.completion.daysLate)
    .filter((d): d is number => d != null && d > 0);
  summary.avgDaysLate =
    allLateDays.length > 0
      ? Math.round((allLateDays.reduce((a, b) => a + b, 0) / allLateDays.length) * 10) / 10
      : null;

  return { from, to, summary, byMember };
}

export { todayIsoDate };
