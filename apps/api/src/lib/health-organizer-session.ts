import {
  diffPlacements,
  fillProgress,
  type DateRange,
  type FillProgress,
  type Placement,
  type PlacementDiff,
  type PlacementProblem,
} from "@domi-ops/calendar-sync";
import type { Env } from "@domi-ops/config";
import {
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthOrganizerOccurrences,
  healthMedications,
  healthOrganizerSessionFills,
  healthOrganizerSessionSkips,
  healthOrganizerSessions,
  type Database,
} from "@domi-ops/db";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { filterVisibleMedicationIds } from "./health-access.js";
import { decryptHealthField, decryptHealthFieldOrPassthrough, encryptHealthField } from "./health-crypto.js";
import { loadPlacements, type PlanRow } from "./health-organizer-plan.js";
import type { Estimate } from "./health-supply.js";
import { quartersToPills } from "./health-supply-validation.js";

/**
 * Filling sessions (WHO-426): the instructions a session starts with (its snapshot), whether they still hold,
 * how far along each medication is, and the supply estimate a fill produces.
 *
 * A session is computed from ALL of the person's medications, not only the ones the viewer may see, so every
 * caregiver working one session is told the same thing. What is shown is then limited to the viewer's medications.
 */

type Auth = { userId: string; householdId: string; memberId: string; role: string };
export type SessionRow = typeof healthOrganizerSessions.$inferSelect;
type FillRow = typeof healthOrganizerSessionFills.$inferSelect;
type SkipRow = typeof healthOrganizerSessionSkips.$inferSelect;
export type SkipReason = SkipRow["reason"];

export type Snapshot = {
  v: 1;
  from: string;
  days: number;
  compartments: Array<{ id: string; name: string; position: number }>;
  /** What the person was told about each medication when the session started. */
  medications: Record<string, { name: string; dosage: string | null; instructions: string | null }>;
  /** [medication id, date, time, compartment id, quarters of a pill] */
  placements: Array<[string, string, string, string, number]>;
  notGuided: Array<{ medicationId: string; reason: string }>;
};

export type BuiltSnapshot = { data: Snapshot; hash: string; errors: PlacementProblem[]; placements: Placement[] };

/** Works out the instructions for the days from `from`, from everything currently set up for the person. */
export async function buildSnapshot(db: Database, env: Env, plan: PlanRow, from: string, days: number): Promise<BuiltSnapshot> {
  const { result, compartments, medications } = await loadPlacements(db, plan, { from, days });
  const guided = new Set(result.placements.map((p) => p.medicationId));
  const medicationsById: Snapshot["medications"] = {};
  for (const m of medications) {
    if (!guided.has(m.id)) continue;
    medicationsById[m.id] = {
      name: decryptHealthFieldOrPassthrough(m.name, env) ?? "",
      dosage: decryptHealthFieldOrPassthrough(m.dosage, env),
      instructions: decryptHealthFieldOrPassthrough(m.instructions, env),
    };
  }
  return {
    data: {
      v: 1,
      from,
      days,
      compartments,
      medications: medicationsById,
      placements: result.placements.map((p) => [p.medicationId, p.date, p.time, p.compartmentId, p.quarters]),
      notGuided: result.notGuided.map((n) => ({ medicationId: n.medicationId, reason: n.reason })),
    },
    hash: result.hash,
    errors: result.problems.filter((p) => p.severity === "error"),
    placements: result.placements,
  };
}

/** The snapshot as stored: encrypted, since it holds medication names, doses and instructions. */
export function encodeSnapshot(env: Env, data: Snapshot): string {
  const sealed = encryptHealthField(JSON.stringify(data), env);
  if (!sealed) throw new Error("snapshot could not be encrypted");
  return sealed;
}

export function decodeSnapshot(env: Env, stored: string): Snapshot {
  const plain = decryptHealthField(stored, env);
  if (!plain) throw new Error("snapshot could not be read");
  return JSON.parse(plain) as Snapshot;
}

const toPlacements = (rows: Snapshot["placements"]): Placement[] =>
  rows.map(([medicationId, date, time, compartmentId, quarters]) => ({ medicationId, date, time, compartmentId, quarters }));

export type SessionMedicationView = {
  medicationId: string;
  name: string;
  dosage: string | null;
  instructions: string | null;
  /** `skipped` wins over how far it got: the person said the rest is not going in. */
  status: FillProgress["status"] | "skipped";
  /** Why this medication is not being filled in this session, if it was skipped. */
  skip: SkipView | null;
  /** Days with a dose, and how many of them are filled. */
  requiredDays: number;
  filledDays: number;
  covered: DateRange[];
  /** Days with a dose that nothing covers yet. */
  missing: DateRange[];
  totalPills: number;
  byCompartment: Array<{ compartmentId: string; pills: number }>;
  placements: Array<{ date: string; time: string; compartmentId: string; pills: number }>;
  /** The latest fill here that has not been undone: the one "undo" would take back. */
  lastFill: FillView | null;
};

export type FillView = {
  id: string;
  medicationId: string;
  coveredFrom: string;
  coveredTo: string;
  outsideDays: number | null;
  supplyRevision: number | null;
  createdAt: string;
  undoneAt: string | null;
};

export type SkipView = { id: string; reason: SkipReason; createdAt: string };

export type ReviewChanges = PlacementDiff & { compartments: CompartmentChange[] };
export type CompartmentChange = { id: string; from: string | null; to: string | null };

export type SessionView = {
  id: string;
  planId: string;
  status: "open" | "finished" | "abandoned";
  version: number;
  coverageStart: string;
  coverageEnd: string;
  fillLengthDays: number;
  /** The appointment (by the day the schedule put it on) this session was started from. */
  occurrenceDate: string | null;
  startedAt: string;
  finishedAt: string | null;
  abandonedAt: string | null;
  /** The schedule, quantities or compartments changed since this session started: more filling waits for a review. */
  reviewRequired: boolean;
  changes: ReviewChanges | null;
  compartments: Snapshot["compartments"];
  medications: SessionMedicationView[];
  notGuided: Snapshot["notGuided"];
  progress: { total: number; filled: number; partial: number; pending: number; skipped: number };
  /** Every fill made in this session, oldest first, undone ones included. */
  fills: FillView[];
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function fillView(f: FillRow): FillView {
  return {
    id: f.id,
    medicationId: f.medicationId,
    coveredFrom: f.coveredFrom,
    coveredTo: f.coveredTo,
    outsideDays: f.outsideDays,
    supplyRevision: f.supplyRevision,
    createdAt: f.createdAt.toISOString(),
    undoneAt: iso(f.undoneAt),
  };
}

export function skipView(s: SkipRow): SkipView {
  return { id: s.id, reason: s.reason, createdAt: s.createdAt.toISOString() };
}

/** The stretches filled for each medication across every session, undone fills left out. */
export async function loadCoverage(db: Database, medicationIds: readonly string[]): Promise<Map<string, DateRange[]>> {
  const out = new Map<string, DateRange[]>();
  if (medicationIds.length === 0) return out;
  const rows = await db
    .select({ medicationId: healthOrganizerSessionFills.medicationId, from: healthOrganizerSessionFills.coveredFrom, to: healthOrganizerSessionFills.coveredTo })
    .from(healthOrganizerSessionFills)
    .where(and(inArray(healthOrganizerSessionFills.medicationId, [...medicationIds]), isNull(healthOrganizerSessionFills.undoneAt)));
  for (const r of rows) {
    const list = out.get(r.medicationId) ?? [];
    list.push({ from: r.from, to: r.to });
    out.set(r.medicationId, list);
  }
  return out;
}

export async function currentHash(
  db: Database,
  plan: PlanRow,
  session: SessionRow,
): Promise<{ hash: string; placements: Placement[]; compartments: Snapshot["compartments"] }> {
  const { result, compartments } = await loadPlacements(db, plan, { from: session.coverageStart, days: session.fillLengthDays });
  return { hash: result.hash, placements: result.placements, compartments };
}

/** Compartments renamed, added or removed since the snapshot (the names are part of what the person is told). */
export function compartmentChanges(before: Snapshot["compartments"], after: Snapshot["compartments"]): CompartmentChange[] {
  const out: CompartmentChange[] = [];
  const now = new Map(after.map((c) => [c.id, c]));
  const was = new Map(before.map((c) => [c.id, c]));
  for (const c of before) {
    const n = now.get(c.id);
    if (!n) out.push({ id: c.id, from: c.name, to: null });
    else if (n.name !== c.name) out.push({ id: c.id, from: c.name, to: n.name });
  }
  for (const c of after) if (!was.has(c.id)) out.push({ id: c.id, from: null, to: c.name });
  return out;
}

/** The session as `auth` sees it: only their medications, with progress, and what changed if the instructions did. */
export async function loadSessionView(db: Database, env: Env, auth: Auth, plan: PlanRow, session: SessionRow): Promise<SessionView> {
  const snapshot = decodeSnapshot(env, session.snapshotJson);
  const snapshotPlacements = toPlacements(snapshot.placements);

  let reviewRequired = false;
  let diff: PlacementDiff | null = null;
  let renamed: CompartmentChange[] = [];
  let currentIds: string[] = [];
  if (session.status === "open") {
    const now = await currentHash(db, plan, session);
    reviewRequired = now.hash !== session.snapshotHash;
    if (reviewRequired) {
      diff = diffPlacements(snapshotPlacements, now.placements);
      renamed = compartmentChanges(snapshot.compartments, now.compartments);
      currentIds = diff.medications.map((m) => m.medicationId);
    }
  }

  const snapshotIds = Object.keys(snapshot.medications);
  const notGuidedIds = snapshot.notGuided.map((n) => n.medicationId);
  const visible = await filterVisibleMedicationIds(db, auth, [...new Set([...snapshotIds, ...currentIds, ...notGuidedIds])]);
  const coverage = await loadCoverage(db, snapshotIds.filter((id) => visible.has(id)));
  const sessionFills = await db
    .select()
    .from(healthOrganizerSessionFills)
    .where(eq(healthOrganizerSessionFills.sessionId, session.id))
    .orderBy(asc(healthOrganizerSessionFills.createdAt), asc(healthOrganizerSessionFills.id));
  const visibleFills = sessionFills.filter((f) => visible.has(f.medicationId));
  const activeSkips = await db
    .select()
    .from(healthOrganizerSessionSkips)
    .where(and(eq(healthOrganizerSessionSkips.sessionId, session.id), isNull(healthOrganizerSessionSkips.undoneAt)));
  const skipByMedication = new Map(activeSkips.map((s) => [s.medicationId, s]));

  const medications: SessionMedicationView[] = [];
  for (const id of snapshotIds.filter((i) => visible.has(i)).sort((a, b) => snapshot.medications[a]!.name.localeCompare(snapshot.medications[b]!.name))) {
    const info = snapshot.medications[id]!;
    const mine = snapshotPlacements.filter((p) => p.medicationId === id);
    const progress = fillProgress(mine.map((p) => p.date), coverage.get(id) ?? []);
    const byCompartment = new Map<string, number>();
    for (const p of mine) byCompartment.set(p.compartmentId, (byCompartment.get(p.compartmentId) ?? 0) + p.quarters);
    const last = [...visibleFills].reverse().find((f) => f.medicationId === id && f.undoneAt === null);
    const skip = skipByMedication.get(id);
    medications.push({
      medicationId: id,
      name: info.name,
      dosage: info.dosage,
      instructions: info.instructions,
      status: skip ? "skipped" : progress.status,
      skip: skip ? skipView(skip) : null,
      requiredDays: progress.requiredCount,
      filledDays: progress.coveredCount,
      covered: progress.covered,
      missing: progress.missing,
      totalPills: quartersToPills(mine.reduce((sum, p) => sum + p.quarters, 0)),
      byCompartment: snapshot.compartments
        .filter((c) => byCompartment.has(c.id))
        .map((c) => ({ compartmentId: c.id, pills: quartersToPills(byCompartment.get(c.id)!) })),
      placements: mine.map((p) => ({ date: p.date, time: p.time, compartmentId: p.compartmentId, pills: quartersToPills(p.quarters) })),
      lastFill: last ? fillView(last) : null,
    });
  }

  let occurrenceDate: string | null = null;
  if (session.occurrenceId) {
    const [occ] = await db
      .select({ date: healthOrganizerOccurrences.occurrenceDate })
      .from(healthOrganizerOccurrences)
      .where(eq(healthOrganizerOccurrences.id, session.occurrenceId))
      .limit(1);
    occurrenceDate = occ?.date ?? null;
  }

  const count = (status: SessionMedicationView["status"]) => medications.filter((m) => m.status === status).length;
  return {
    id: session.id,
    planId: session.planId,
    status: session.status as SessionView["status"],
    version: session.version,
    coverageStart: session.coverageStart,
    coverageEnd: addDays(session.coverageStart, session.fillLengthDays - 1),
    fillLengthDays: session.fillLengthDays,
    occurrenceDate,
    startedAt: session.startedAt.toISOString(),
    finishedAt: iso(session.finishedAt),
    abandonedAt: iso(session.abandonedAt),
    reviewRequired,
    changes: diff ? { changed: diff.changed || renamed.length > 0, medications: diff.medications.filter((m) => visible.has(m.medicationId)), compartments: renamed } : null,
    compartments: snapshot.compartments,
    medications,
    notGuided: snapshot.notGuided.filter((n) => visible.has(n.medicationId)),
    progress: { total: medications.length, filled: count("filled"), partial: count("partial"), pending: count("pending"), skipped: count("skipped") },
    fills: visibleFills.map(fillView),
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type CatchUp = { coverageStart: string; fillLengthDays: number; medicationIds: string[] };

const CATCH_UP_SCAN = 100;

/**
 * The days a medication that ran out still needs, from the latest ended session that has any. The next session normally
 * starts after the last day anything was filled to, so without this those days would never be offered again. Past days
 * are gone, medications no longer going in the organizer are left out, and the person decides whether to take it up.
 */
export async function loadCatchUp(db: Database, env: Env, auth: Auth, plan: PlanRow, today: string): Promise<CatchUp | null> {
  const rows = await db
    .select({
      sessionId: healthOrganizerSessions.id,
      medicationId: healthOrganizerSessionSkips.medicationId,
      coverageStart: healthOrganizerSessions.coverageStart,
      fillLengthDays: healthOrganizerSessions.fillLengthDays,
      snapshotJson: healthOrganizerSessions.snapshotJson,
    })
    .from(healthOrganizerSessionSkips)
    .innerJoin(healthOrganizerSessions, eq(healthOrganizerSessions.id, healthOrganizerSessionSkips.sessionId))
    .where(
      and(
        eq(healthOrganizerSessions.planId, plan.id),
        ne(healthOrganizerSessions.status, "open"),
        eq(healthOrganizerSessionSkips.reason, "out_of_stock"),
        isNull(healthOrganizerSessionSkips.undoneAt),
      ),
    )
    .orderBy(desc(healthOrganizerSessions.startedAt))
    .limit(CATCH_UP_SCAN);
  if (rows.length === 0) return null;

  const ids = [...new Set(rows.map((r) => r.medicationId))];
  const visible = await filterVisibleMedicationIds(db, auth, ids);
  const stillGoingIn = await db
    .select({ id: healthMedications.id })
    .from(healthMedications)
    .where(and(inArray(healthMedications.id, ids), isNull(healthMedications.deletedAt), eq(healthMedications.enabled, true), eq(healthMedications.organizerExcluded, false)));
  const eligible = new Set(stillGoingIn.map((m) => m.id).filter((id) => visible.has(id)));
  const coverage = await loadCoverage(db, [...eligible]);

  for (const sessionId of new Set(rows.map((r) => r.sessionId))) {
    const mine = rows.filter((r) => r.sessionId === sessionId);
    const end = addDays(mine[0]!.coverageStart, mine[0]!.fillLengthDays - 1);
    if (end < today) continue;
    const snapshot = decodeSnapshot(env, mine[0]!.snapshotJson);
    let first: string | null = null;
    const medicationIds: string[] = [];
    for (const { medicationId } of mine) {
      if (!eligible.has(medicationId)) continue;
      const dates = snapshot.placements.filter((p) => p[0] === medicationId && p[1] >= today).map((p) => p[1]);
      const start = fillProgress(dates, coverage.get(medicationId) ?? []).missing[0]?.from;
      if (!start) continue;
      medicationIds.push(medicationId);
      if (first === null || start < first) first = start;
    }
    if (first !== null) {
      const fillLengthDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
      return { coverageStart: first, fillLengthDays, medicationIds };
    }
  }
  return null;
}

/**
 * Saves a supply estimate that a fill produced: the medication's supply row and an appended revision that points at the
 * session. Returns the revision it saved as.
 */
export async function applyFillEstimate(
  db: Database,
  input: { medicationId: string; estimate: Estimate; today: string; sessionId: string; userId: string },
): Promise<number> {
  const { medicationId, estimate, today } = input;
  const values = { runsOutOn: estimate.runsOutOn, estimatedOn: today, outsideDays: estimate.outsideDays, organizerDaysCounted: estimate.organizerDays };
  const [existing] = await db.select({ id: healthMedicationSupply.medicationId }).from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, medicationId)).limit(1);
  let revision: number;
  if (!existing) {
    const [created] = await db
      .insert(healthMedicationSupply)
      .values({ medicationId, ...values, revision: 1 })
      .onConflictDoNothing()
      .returning({ revision: healthMedicationSupply.revision });
    if (created) {
      revision = created.revision;
    } else {
      revision = await bumpSupply(db, medicationId, values);
    }
  } else {
    revision = await bumpSupply(db, medicationId, values);
  }
  await db.insert(healthMedicationSupplyRevisions).values({
    medicationId,
    revision,
    source: "fill",
    ...values,
    sessionId: input.sessionId,
    createdByUserId: input.userId,
  });
  return revision;
}

async function bumpSupply(
  db: Database,
  medicationId: string,
  values: { runsOutOn: string; estimatedOn: string; outsideDays: number; organizerDaysCounted: number },
): Promise<number> {
  const [saved] = await db
    .update(healthMedicationSupply)
    .set({
      ...values,
      revision: sql`${healthMedicationSupply.revision} + 1`,
      version: sql`${healthMedicationSupply.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(healthMedicationSupply.medicationId, medicationId))
    .returning({ revision: healthMedicationSupply.revision });
  return saved!.revision;
}

/**
 * Takes back the estimate a fill produced, if nothing has changed it since: the previous estimate becomes current
 * again (as a new revision, history is only ever added to), or, if the fill made the first one, the estimate is cleared.
 * When the estimate has been changed since, it is left alone and `false` is returned.
 */
export async function restoreEstimateBefore(
  db: Database,
  input: { medicationId: string; fillRevision: number; sessionId: string; userId: string },
): Promise<boolean> {
  // Lock the row while checking it: a change to the estimate that commits between this read and the write below
  // (a manual update, a receipt) would otherwise be overwritten.
  const [supply] = await db
    .select()
    .from(healthMedicationSupply)
    .where(eq(healthMedicationSupply.medicationId, input.medicationId))
    .for("update")
    .limit(1);
  if (!supply || supply.revision !== input.fillRevision) return false;

  const [prior] = await db
    .select()
    .from(healthMedicationSupplyRevisions)
    .where(and(eq(healthMedicationSupplyRevisions.medicationId, input.medicationId), eq(healthMedicationSupplyRevisions.revision, input.fillRevision - 1)))
    .limit(1);

  if (!prior) {
    await db
      .update(healthMedicationSupply)
      .set({ runsOutOn: null, estimatedOn: null, outsideDays: null, organizerDaysCounted: null, version: sql`${healthMedicationSupply.version} + 1`, updatedAt: new Date() })
      .where(eq(healthMedicationSupply.medicationId, input.medicationId));
    return true;
  }
  const values = { runsOutOn: prior.runsOutOn, estimatedOn: prior.estimatedOn, outsideDays: prior.outsideDays, organizerDaysCounted: prior.organizerDaysCounted };
  const revision = await bumpSupply(db, input.medicationId, values);
  await db.insert(healthMedicationSupplyRevisions).values({
    medicationId: input.medicationId,
    revision,
    source: "fill",
    ...values,
    sessionId: input.sessionId,
    createdByUserId: input.userId,
  });
  return true;
}
