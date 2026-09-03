import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { isModuleEnabled } from "@domi-ops/config";
import {
  healthMedPushActionSecret,
  verifyHealthMedPushActionToken,
  type HealthMedPushActionStatus,
} from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthMedicationGroups,
  healthMedicationLogs,
  healthMedications,
  householdMembers,
  households,
} from "@domi-ops/db";
import { and, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import {
  isHouseholdModuleEnabled,
  requireHouseholdModule,
} from "../lib/household-modules.js";
import { HealthEncryptionError } from "../lib/health-crypto.js";
import {
  canManageMemberHealth,
  hasHealthSegmentAccess,
  healthEventVisibleWhere,
  healthMedicationGroupVisibleWhere,
  healthMedicationVisibleWhere,
  loadGroupMemberMedicationIdsMap,
  loadHealthAclForSubject,
  loadHealthCapabilities,
  loadHealthEventShareMap,
  loadHealthMedicationGroupMembershipMap,
  loadHealthMedicationShareMap,
  normalizeHealthAclLevel,
  normalizeHealthVisibility,
  removeMedicationFromAllGroups,
  replaceHealthAclForSubject,
  replaceHealthEventShares,
  replaceHealthMedicationShares,
  validateHealthShareMemberIds,
  type HealthAclGrants,
} from "../lib/health-access.js";
import { addDaysIso, todayIsoDateInTz, zonedLocalToUtc, formatTimeLabelInTz, resolveAlertTimeZone, nextIntervalPending, parseIntervalSchedule } from "@domi-ops/calendar-sync";
import {
  encryptHealthTextFields,
  enrichHealthEvents,
  enrichHealthMedications,
  loadVitalsReadingsForEvents,
  normalizeMedSchedule,
  parseMedSchedule,
  replaceVitalsReadings,
  resolveEventInstant,
  serializeHealthEvent,
  serializeHealthLog,
  serializeHealthMedication,
  type SerializedVitalsReading,
} from "../lib/health-serialize.js";
import { buildHealthReports, VITALS_METRICS } from "../lib/health-reports.js";
import { decryptHealthFieldOrPassthrough, encryptHealthField } from "../lib/health-crypto.js";
import {
  GLANCE_DOSE_LOG_LOOKBACK_DAYS,
  isInstantLogged,
  loadDoseLogMap,
  recordDose,
} from "../lib/health-med-logging.js";

function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
}

function normalizeDurationKind(value: unknown): "single_day" | "ongoing" {
  return value === "ongoing" ? "ongoing" : "single_day";
}

type VitalsReadingInput = { metric: string; value: number; unit: string };

/** Drop malformed entries rather than reject the whole request — mirrors reminderOffsets filtering. */
function normalizeVitalsReadings(value: unknown): VitalsReadingInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: VitalsReadingInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const metric = (entry as { metric?: unknown }).metric;
    const rawValue = (entry as { value?: unknown }).value;
    const unit = (entry as { unit?: unknown }).unit;
    if (
      typeof metric !== "string" ||
      !VITALS_METRICS.includes(metric) ||
      typeof rawValue !== "number" ||
      !Number.isFinite(rawValue) ||
      typeof unit !== "string" ||
      !unit.trim()
    ) {
      continue;
    }
    out.push({ metric, value: rawValue, unit: unit.trim() });
  }
  return out;
}

function normalizePushActionStatus(value: unknown): HealthMedPushActionStatus | null {
  if (value === "taken") return "taken";
  if (value === "skipped" || value === "skip") return "skipped";
  return null;
}

async function householdTimezone(db: Database, householdId: string): Promise<string> {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  return household?.timezone ?? "UTC";
}

function requestTimeZone(
  c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } },
  householdTimezone: string,
): string {
  return resolveAlertTimeZone({
    deviceTimezone: c.req.header("x-client-timezone") ?? c.req.query("timezone"),
    householdTimezone,
  });
}

export function householdHealthRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  /**
   * Token-authenticated dose log for Web Push action buttons / iOS deep links (WHO-235).
   * Registered before requireAuth — cookie session is optional.
   */
  app.post("/medications/push-action", async (c) => {
    if (!isModuleEnabled(env, "health")) {
      return c.json({ error: "module_disabled" }, 403);
    }

    const secret = healthMedPushActionSecret(env);
    if (!secret) {
      return c.json({ error: "token_unavailable" }, 503);
    }

    const body = await c.req.json<{ token?: string; action?: string }>().catch(() => ({} as {
      token?: string;
      action?: string;
    }));
    const token = typeof body.token === "string" ? body.token : "";
    const status = normalizePushActionStatus(body.action);
    if (!token || !status) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const claims = verifyHealthMedPushActionToken(token, secret);
    if (!claims) {
      return c.json({ error: "invalid_token" }, 401);
    }
    if (!claims.actions.includes(status)) {
      return c.json({ error: "action_not_allowed" }, 403);
    }

    if (!(await isHouseholdModuleEnabled(db, env, claims.householdId, "health"))) {
      return c.json({ error: "module_disabled" }, 403);
    }

    const [member] = await db
      .select({
        memberId: householdMembers.id,
        role: householdMembers.role,
        userId: householdMembers.userId,
        householdId: householdMembers.householdId,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, claims.userId),
          eq(householdMembers.householdId, claims.householdId),
        ),
      )
      .limit(1);
    if (!member?.userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    const auth = {
      userId: member.userId,
      householdId: member.householdId,
      memberId: member.memberId,
      role: member.role,
    };

    const [med] = await db
      .select()
      .from(healthMedications)
      .where(
        and(
          eq(healthMedications.id, claims.medicationId),
          eq(healthMedications.householdId, claims.householdId),
        ),
      )
      .limit(1);
    if (!med) {
      return c.json({ error: "not_found" }, 404);
    }

    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "doses", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const scheduledAt = new Date(claims.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return c.json({ error: "invalid_token" }, 401);
    }

    // Tapping a per-med notification button is a `single` action: if this dose was already
    // logged (e.g. skipped earlier, then "Taken" tapped on the still-visible notification), it
    // flips. See recordDose's conflict rule.
    try {
      const { log, outcome } = await recordDose(db, env, {
        med,
        householdId: auth.householdId,
        loggedByUserId: auth.userId,
        status,
        scheduledAt,
        loggedAt: new Date(),
        source: "single",
      });
      return c.json({ ok: true, alreadyLogged: outcome !== "inserted", log }, outcome === "inserted" ? 201 : 200);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  app.get("/capabilities", async (c) => {
    const auth = c.get("auth")!;
    const members = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, auth.householdId));
    const bySubject = await loadHealthCapabilities(
      db,
      auth,
      members.map((m) => m.id),
    );
    return c.json({ bySubject });
  });

  app.get("/acl/:subjectMemberId", async (c) => {
    const auth = c.get("auth")!;
    const subjectMemberId = c.req.param("subjectMemberId");
    if (!canManageMemberHealth(auth.role, subjectMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [subject] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, subjectMemberId),
          eq(householdMembers.householdId, auth.householdId),
        ),
      )
      .limit(1);
    if (!subject) return c.json({ error: "not_found" }, 404);
    const grants = await loadHealthAclForSubject(db, auth.householdId, subjectMemberId);
    return c.json({ subjectMemberId, grants });
  });

  app.put("/acl/:subjectMemberId", async (c) => {
    const auth = c.get("auth")!;
    const subjectMemberId = c.req.param("subjectMemberId");
    if (!canManageMemberHealth(auth.role, subjectMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [subject] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, subjectMemberId),
          eq(householdMembers.householdId, auth.householdId),
        ),
      )
      .limit(1);
    if (!subject) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json<{
      grants?: Array<{
        granteeMemberId: string;
        events?: string;
        medications?: string;
        doses?: string;
        reports?: string;
      }>;
    }>();

    const raw = Array.isArray(body.grants) ? body.grants : [];
    const granteeIds = await validateHealthShareMemberIds(
      db,
      auth.householdId,
      raw.map((g) => g.granteeMemberId),
      subjectMemberId,
    );
    const valid = new Set(granteeIds);
    const entries: Array<{ granteeMemberId: string } & HealthAclGrants> = [];
    for (const g of raw) {
      if (!valid.has(g.granteeMemberId)) continue;
      entries.push({
        granteeMemberId: g.granteeMemberId,
        events: normalizeHealthAclLevel(g.events),
        medications: normalizeHealthAclLevel(g.medications),
        doses: normalizeHealthAclLevel(g.doses),
        reports: normalizeHealthAclLevel(g.reports),
      });
    }
    await replaceHealthAclForSubject(db, auth.householdId, subjectMemberId, entries);
    const grants = await loadHealthAclForSubject(db, auth.householdId, subjectMemberId);
    return c.json({ subjectMemberId, grants });
  });

  app.get("/glance", async (c) => {
    const auth = c.get("auth")!;
    const [household] = await db
      .select({ timezone: households.timezone })
      .from(households)
      .where(eq(households.id, auth.householdId))
      .limit(1);
    const householdTz = household?.timezone ?? "UTC";
    const tz = requestTimeZone(c, householdTz);
    const today = todayIsoDateInTz(tz);
    const dayStart = zonedLocalToUtc(today, "00:00", tz);
    const dayEnd = zonedLocalToUtc(today, "23:59", tz);
    const nextDayStart = zonedLocalToUtc(addDaysIso(today, 1), "00:00", tz);

    const eventRows = await db
      .select()
      .from(healthEvents)
      .where(healthEventVisibleWhere(db, auth))
      .orderBy(desc(healthEvents.startedAt))
      .limit(20);

    const medRows = await db
      .select()
      .from(healthMedications)
      .where(
        and(healthMedicationVisibleWhere(db, auth), eq(healthMedications.enabled, true)),
      );

    // Groups are many-to-many with medications (health_medication_group_members) — a med taken
    // multiple times a day can have different doses claimed by different groups. For a
    // scheduled-kind group, a member medication's dose at time T is only "claimed" (excluded
    // from its own standalone pendingDoses, folded into the group's pendingGroupDoses instead)
    // when T is in BOTH the group's own times and that medication's own times — belonging to a
    // group doesn't mean every one of a medication's doses is covered, only the matching ones.
    // Interval-kind groups have no discrete time to match against, so membership there still
    // works the simpler way it always did: the whole interval schedule delegates to the group.
    const groupRows = await db
      .select()
      .from(healthMedicationGroups)
      .where(and(healthMedicationGroupVisibleWhere(db, auth), eq(healthMedicationGroups.enabled, true)));
    const enabledGroupIds = groupRows.map((g) => g.id);
    const groupById = new Map(groupRows.map((g) => [g.id, g]));

    const medGroupMembershipMap = await loadHealthMedicationGroupMembershipMap(
      db,
      medRows.map((m) => m.id),
    );

    function scheduledTimesClaimedByGroups(medId: string): Set<string> {
      const claimed = new Set<string>();
      for (const groupId of medGroupMembershipMap.get(medId) ?? []) {
        const group = groupById.get(groupId);
        if (!group || group.scheduleKind !== "scheduled") continue;
        for (const t of parseMedSchedule(group.scheduleJson).times ?? []) {
          claimed.add(t.slice(0, 5));
        }
      }
      return claimed;
    }

    function isDelegatedToIntervalGroup(medId: string): boolean {
      return (medGroupMembershipMap.get(medId) ?? []).some(
        (groupId) => groupById.get(groupId)?.scheduleKind === "interval",
      );
    }

    const scheduledMeds = medRows.filter((m) => m.scheduleKind === "scheduled");
    const intervalMeds = medRows.filter(
      (m) => m.scheduleKind === "interval" && !isDelegatedToIntervalGroup(m.id),
    );
    const prnMeds = medRows.filter((m) => m.scheduleKind === "prn");

    // Group member medications, keyed by groupId — fetched independent of each medication's own
    // visibility (the group's own visibility, already checked above, is what gates seeing it and
    // everything nested inside it; a member medication's individual visibility setting becomes
    // moot once it's part of a group).
    const groupMemberMedsMap = new Map<string, (typeof healthMedications.$inferSelect)[]>();
    if (groupRows.length > 0) {
      const [groupMemberIdsMap, allHouseholdMeds] = await Promise.all([
        loadGroupMemberMedicationIdsMap(db, enabledGroupIds),
        db
          .select()
          .from(healthMedications)
          .where(
            and(
              eq(healthMedications.householdId, auth.householdId),
              eq(healthMedications.enabled, true),
            ),
          ),
      ]);
      const medsById = new Map(allHouseholdMeds.map((m) => [m.id, m]));
      for (const [groupId, medicationIds] of groupMemberIdsMap) {
        const members = medicationIds.map((id) => medsById.get(id)).filter((m) => m !== undefined);
        groupMemberMedsMap.set(groupId, members);
      }
    }

    // One query for every "is this dose logged" check below, instead of a lookup per med per
    // time slot (WHO-280).
    const glanceMedIds = [
      ...new Set([
        ...medRows.map((m) => m.id),
        ...[...groupMemberMedsMap.values()].flat().map((m) => m.id),
      ]),
    ];
    const doseLogLookbackStart = new Date(
      dayStart.getTime() - GLANCE_DOSE_LOG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const doseLogMap = await loadDoseLogMap(db, glanceMedIds, doseLogLookbackStart);

    const pendingDoses: {
      medicationId: string;
      name: string;
      dosage: string | null;
      scheduledAt: string;
      scheduledTime: string;
      scheduledTimeLabel: string;
      memberId: string;
      awaitingFirst?: boolean;
    }[] = [];

    const pendingGroupDoses: {
      groupId: string;
      name: string;
      scheduledAt: string;
      scheduledTime: string;
      scheduledTimeLabel: string;
      memberId: string;
      medications: { medicationId: string; name: string; dosage: string | null; alreadyLogged: boolean }[];
    }[] = [];

    for (const med of scheduledMeds) {
      const schedule = parseMedSchedule(med.scheduleJson);
      const times = schedule.times ?? [];
      const name = decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication";
      const dosage = decryptHealthFieldOrPassthrough(med.dosage, env);
      if (med.startDate && today < med.startDate) continue;
      if (med.endDate && today > med.endDate) continue;
      if (schedule.daysOfWeek?.length) {
        const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
        if (!schedule.daysOfWeek.includes(dow)) continue;
      }
      const claimedTimes = scheduledTimesClaimedByGroups(med.id);
      for (const time of times) {
        const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
        if (claimedTimes.has(hhmm)) continue; // this specific dose belongs to a group instead
        const scheduledAt = zonedLocalToUtc(today, hhmm, tz);
        if (scheduledAt < dayStart || scheduledAt > dayEnd) continue;
        if (!isInstantLogged(doseLogMap, med.id, scheduledAt)) {
          pendingDoses.push({
            medicationId: med.id,
            name,
            dosage,
            scheduledAt: scheduledAt.toISOString(),
            scheduledTime: hhmm,
            scheduledTimeLabel: formatTimeLabelInTz(scheduledAt, tz),
            memberId: med.memberId,
          });
        }
      }
    }

    for (const med of intervalMeds) {
      if (med.startDate && today < med.startDate) continue;
      if (med.endDate && today > med.endDate) continue;
      const schedule = parseIntervalSchedule(med.scheduleJson);
      if (!schedule) continue;
      const name = decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication";
      const dosage = decryptHealthFieldOrPassthrough(med.dosage, env);
      const pending = nextIntervalPending({
        schedule,
        tz,
        date: today,
        now: new Date(),
        logs: doseLogMap.get(med.id) ?? [],
      });
      if (!pending) continue;
      pendingDoses.push({
        medicationId: med.id,
        name,
        dosage,
        scheduledAt: pending.scheduledAt.toISOString(),
        scheduledTime: pending.scheduledTime,
        scheduledTimeLabel: pending.scheduledTimeLabel,
        memberId: med.memberId,
        awaitingFirst: pending.awaitingFirst,
      });
    }

    pendingDoses.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

    const scheduledGroups = groupRows.filter((g) => g.scheduleKind === "scheduled");
    const intervalGroups = groupRows.filter((g) => g.scheduleKind === "interval");

    for (const group of scheduledGroups) {
      const members = groupMemberMedsMap.get(group.id) ?? [];
      if (members.length === 0) continue;
      const schedule = parseMedSchedule(group.scheduleJson);
      const times = schedule.times ?? [];
      const name = decryptHealthFieldOrPassthrough(group.name, env) ?? "Medications";
      if (group.startDate && today < group.startDate) continue;
      if (group.endDate && today > group.endDate) continue;
      if (schedule.daysOfWeek?.length) {
        const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
        if (!schedule.daysOfWeek.includes(dow)) continue;
      }
      for (const time of times) {
        const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
        const scheduledAt = zonedLocalToUtc(today, hhmm, tz);
        if (scheduledAt < dayStart || scheduledAt > dayEnd) continue;
        // Which members actually have a dose at THIS specific time — belonging to the group
        // doesn't mean every one of a member's own times matches every one of the group's.
        const membersAtThisTime = members.filter(
          (m) =>
            m.scheduleKind === "scheduled" &&
            (parseMedSchedule(m.scheduleJson).times ?? []).some((t) => t.slice(0, 5) === hhmm),
        );
        if (membersAtThisTime.length === 0) continue;
        // Partial-take: a group dose stays pending until EVERY member medication has a log for
        // this instant, not just one — someone taking 2 of 3 meds early shouldn't make the
        // group's reminder disappear before the 3rd is handled.
        const loggedIds = new Set(
          membersAtThisTime.filter((m) => isInstantLogged(doseLogMap, m.id, scheduledAt)).map((m) => m.id),
        );
        if (loggedIds.size >= membersAtThisTime.length) continue;
        pendingGroupDoses.push({
          groupId: group.id,
          name,
          scheduledAt: scheduledAt.toISOString(),
          scheduledTime: hhmm,
          scheduledTimeLabel: formatTimeLabelInTz(scheduledAt, tz),
          memberId: group.memberId,
          medications: membersAtThisTime.map((m) => ({
            medicationId: m.id,
            name: decryptHealthFieldOrPassthrough(m.name, env) ?? "Medication",
            dosage: decryptHealthFieldOrPassthrough(m.dosage, env),
            alreadyLogged: loggedIds.has(m.id),
          })),
        });
      }
    }

    for (const group of intervalGroups) {
      const members = groupMemberMedsMap.get(group.id) ?? [];
      if (members.length === 0) continue;
      if (group.startDate && today < group.startDate) continue;
      if (group.endDate && today > group.endDate) continue;
      const schedule = parseIntervalSchedule(group.scheduleJson);
      if (!schedule) continue;
      const name = decryptHealthFieldOrPassthrough(group.name, env) ?? "Medications";
      const memberIds = members.map((m) => m.id);
      // The group's interval clock is driven by the union of all member medications' log
      // history — once grouped, the group's own schedule (not any individual member's) is
      // authoritative, so "last taken" resets on whichever member dose was logged most recently.
      const pending = nextIntervalPending({
        schedule,
        tz,
        date: today,
        now: new Date(),
        logs: memberIds.flatMap((id) => doseLogMap.get(id) ?? []),
      });
      if (!pending) continue;
      const loggedForPendingIds = new Set(
        memberIds.filter((id) => isInstantLogged(doseLogMap, id, pending.scheduledAt)),
      );
      pendingGroupDoses.push({
        groupId: group.id,
        name,
        scheduledAt: pending.scheduledAt.toISOString(),
        scheduledTime: pending.scheduledTime,
        scheduledTimeLabel: pending.scheduledTimeLabel,
        memberId: group.memberId,
        medications: members.map((m) => ({
          medicationId: m.id,
          name: decryptHealthFieldOrPassthrough(m.name, env) ?? "Medication",
          dosage: decryptHealthFieldOrPassthrough(m.dosage, env),
          alreadyLogged: loggedForPendingIds.has(m.id),
        })),
      });
    }

    pendingGroupDoses.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

    // Doses already logged today — so the Today tab can show them with an Undo (WHO-280).
    const visibleMedIds = medRows.map((m) => m.id);
    const medRowById = new Map(medRows.map((m) => [m.id, m]));
    const todaysLogs = visibleMedIds.length
      ? await db
          .select()
          .from(healthMedicationLogs)
          .where(
            and(
              inArray(healthMedicationLogs.medicationId, visibleMedIds),
              or(
                and(
                  gte(healthMedicationLogs.scheduledAt, dayStart),
                  lte(healthMedicationLogs.scheduledAt, dayEnd),
                ),
                and(
                  isNull(healthMedicationLogs.scheduledAt),
                  gte(healthMedicationLogs.loggedAt, dayStart),
                  lt(healthMedicationLogs.loggedAt, nextDayStart),
                ),
              ),
            ),
          )
          .orderBy(desc(healthMedicationLogs.loggedAt))
      : [];
    const loggedToday = todaysLogs.map((l) => {
      const med = medRowById.get(l.medicationId)!;
      return {
        logId: l.id,
        medicationId: l.medicationId,
        name: decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication",
        dosage: decryptHealthFieldOrPassthrough(med.dosage, env),
        memberId: med.memberId,
        status: l.status,
        scheduledAt: l.scheduledAt?.toISOString() ?? null,
        scheduledTimeLabel: l.scheduledAt ? formatTimeLabelInTz(l.scheduledAt, tz) : null,
        loggedAtLabel: formatTimeLabelInTz(l.loggedAt, tz),
      };
    });

    const events = await enrichHealthEvents(db, env, auth, eventRows.slice(0, 5));
    const prnList = await enrichHealthMedications(db, env, auth, prnMeds);

    return c.json({
      enabled: true,
      today,
      timezone: tz,
      householdTimezone: householdTz,
      activeEvents: events,
      pendingDoses,
      pendingGroupDoses,
      prnMedications: prnList,
      loggedToday,
    });
  });

  app.get("/reports", async (c) => {
    const auth = c.get("auth")!;
    const to = c.req.query("to")?.trim() || todayIsoDateInTz(await householdTimezone(db, auth.householdId));
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = c.req.query("from")?.trim() || fromDefault.toISOString().slice(0, 10);
    const memberId = c.req.query("memberId")?.trim() || null;
    const eventType = c.req.query("eventType")?.trim() || null;
    const groupBy = c.req.query("groupBy")?.trim() || null;
    const medicationId = c.req.query("medicationId")?.trim() || null;
    const scheduleKind = c.req.query("scheduleKind")?.trim() || null;
    const report = await buildHealthReports(db, env, auth, from, to, {
      memberId,
      eventType,
      groupBy,
      medicationId,
      scheduleKind,
    });
    return c.json(report);
  });

  app.get("/events", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(healthEvents)
      .where(healthEventVisibleWhere(db, auth))
      .orderBy(desc(healthEvents.startedAt));
    const events = await enrichHealthEvents(db, env, auth, rows);
    return c.json({ events });
  });

  app.get("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(healthEvents)
      .where(
        and(eq(healthEvents.id, id), eq(healthEvents.householdId, auth.householdId)),
      )
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const visible = await db
      .select({ id: healthEvents.id })
      .from(healthEvents)
      .where(and(eq(healthEvents.id, id), healthEventVisibleWhere(db, auth)))
      .limit(1);
    if (visible.length === 0) return c.json({ error: "not_found" }, 404);
    const [event] = await enrichHealthEvents(db, env, auth, [row]);
    return c.json({ event });
  });

  app.post("/events", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      memberId: string;
      type?: string;
      title: string;
      notes?: string;
      startedAt?: string;
      endedAt?: string;
      startDate?: string | null;
      startTime?: string | null;
      endDate?: string | null;
      endTime?: string | null;
      durationKind?: string;
      visibility?: string;
      sharedMemberIds?: string[];
      medicationId?: string;
      readings?: unknown;
    }>();

    if (!body.memberId || !body.title?.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      const enc = encryptHealthTextFields(env, {
        title: body.title.trim(),
        notes: body.notes ?? null,
      });
      const visibility = normalizeHealthVisibility(body.visibility);
      const durationKind = normalizeDurationKind(body.durationKind);
      const tz = await householdTimezone(db, auth.householdId);
      const startedAt = resolveEventInstant(
        {
          startDate: body.startDate,
          startTime: body.startTime,
          startedAt: body.startedAt,
        },
        tz,
      );
      let endedAt: Date | null = null;
      if (durationKind === "ongoing") {
        if (body.endDate !== undefined) {
          endedAt = body.endDate
            ? resolveEventInstant(
                { startDate: body.endDate, startTime: body.endTime ?? "00:00" },
                tz,
              ) ?? null
            : null;
        } else if (body.endedAt) {
          endedAt = new Date(body.endedAt);
        }
      }
      const [row] = await db
        .insert(healthEvents)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          medicationId: body.medicationId ?? null,
          type: (body.type as typeof healthEvents.$inferInsert.type) ?? "other",
          title: enc.title!,
          notes: enc.notes ?? null,
          startedAt: startedAt ?? null,
          endedAt,
          durationKind,
          visibility,
          createdByUserId: auth.userId,
        })
        .returning();

      let sharedMemberIds: string[] = [];
      if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
        sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthEventShares(db, row.id, sharedMemberIds);
      }

      let readings: SerializedVitalsReading[] | undefined;
      const readingsInput = normalizeVitalsReadings(body.readings);
      if (readingsInput) {
        await replaceVitalsReadings(db, env, row.id, readingsInput);
        readings = (await loadVitalsReadingsForEvents(db, env, [row.id])).get(row.id) ?? [];
      }

      return c.json(
        {
          event: serializeHealthEvent(row, env, {
            sharedMemberIds,
            isOwnedByMe: true,
            canEdit: true,
            readings,
          }, tz),
        },
        201,
      );
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthEvents)
      .where(and(eq(healthEvents.id, id), eq(healthEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const canWriteEvent =
      existing.createdByUserId === auth.userId ||
      existing.visibility === "household" ||
      (await hasHealthSegmentAccess(db, auth, existing.memberId, "events", "write"));
    if (existing.visibility === "private" && !canWriteEvent) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      type?: string;
      title?: string;
      notes?: string | null;
      startedAt?: string | null;
      endedAt?: string | null;
      startDate?: string | null;
      startTime?: string | null;
      endDate?: string | null;
      endTime?: string | null;
      durationKind?: string;
      visibility?: string;
      sharedMemberIds?: string[];
      memberId?: string;
      readings?: unknown;
    }>();

    try {
      const tz = await householdTimezone(db, auth.householdId);
      const patch: Partial<typeof healthEvents.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) {
        patch.title = encryptHealthField(body.title, env) ?? "";
      }
      if (body.notes !== undefined) patch.notes = encryptHealthField(body.notes, env);
      if (body.type !== undefined) patch.type = body.type as typeof patch.type;
      const startedInstant = resolveEventInstant(
        {
          startDate: body.startDate,
          startTime: body.startTime,
          startedAt: body.startedAt,
        },
        tz,
      );
      if (startedInstant !== undefined) patch.startedAt = startedInstant;
      if (body.durationKind !== undefined) {
        patch.durationKind = normalizeDurationKind(body.durationKind);
      }
      const nextDurationKind =
        body.durationKind !== undefined
          ? normalizeDurationKind(body.durationKind)
          : (existing.durationKind ?? "single_day");
      if (nextDurationKind === "ongoing") {
        if (body.endDate !== undefined) {
          patch.endedAt = body.endDate
            ? resolveEventInstant(
                { startDate: body.endDate, startTime: body.endTime ?? "00:00" },
                tz,
              ) ?? null
            : null;
        } else if (body.endedAt !== undefined) {
          patch.endedAt = body.endedAt ? new Date(body.endedAt) : null;
        }
      } else if (body.durationKind !== undefined) {
        patch.endedAt = null;
      }
      if (body.memberId !== undefined) {
        if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "events", "write"))) {
          return c.json({ error: "forbidden" }, 403);
        }
        patch.memberId = body.memberId;
      }
      if (body.visibility !== undefined) patch.visibility = normalizeHealthVisibility(body.visibility);

      const [row] = await db
        .update(healthEvents)
        .set(patch)
        .where(eq(healthEvents.id, id))
        .returning();

      if (body.sharedMemberIds !== undefined && row.visibility === "private") {
        const sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthEventShares(db, row.id, sharedMemberIds);
      }
      if (row.visibility === "household") {
        await replaceHealthEventShares(db, row.id, []);
      }

      let readings: SerializedVitalsReading[] | undefined;
      const readingsInput = normalizeVitalsReadings(body.readings);
      if (readingsInput !== undefined) {
        await replaceVitalsReadings(db, env, row.id, readingsInput);
      }
      if (row.type === "vitals") {
        readings = (await loadVitalsReadingsForEvents(db, env, [row.id])).get(row.id) ?? [];
      }

      const shareMap = await loadHealthEventShareMap(
        db,
        row.visibility === "private" ? [row.id] : [],
      );
      return c.json({
        event: serializeHealthEvent(row, env, {
          sharedMemberIds: shareMap.get(row.id),
          isOwnedByMe: row.createdByUserId === auth.userId,
          canEdit: true,
          readings,
        }, tz),
      });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthEvents)
      .where(and(eq(healthEvents.id, id), eq(healthEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const canDelete =
      existing.createdByUserId === auth.userId ||
      (await hasHealthSegmentAccess(db, auth, existing.memberId, "events", "write"));
    if (!canDelete) {
      return c.json({ error: "forbidden" }, 403);
    }
    await db.delete(healthEvents).where(eq(healthEvents.id, id));
    return c.json({ ok: true });
  });

  app.get("/medications", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(healthMedications)
      .where(healthMedicationVisibleWhere(db, auth))
      .orderBy(desc(healthMedications.createdAt));
    const medications = await enrichHealthMedications(db, env, auth, rows);
    return c.json({ medications });
  });

  app.post("/medications", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      memberId: string;
      name: string;
      dosage?: string;
      instructions?: string;
      scheduleKind?: string;
      schedule?: { times?: string[]; daysOfWeek?: number[] };
      reminderOffsets?: number[];
      startDate?: string;
      endDate?: string;
      enabled?: boolean;
      visibility?: string;
      sharedMemberIds?: string[];
    }>();

    if (!body.memberId || !body.name?.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      let scheduleMeta: { scheduleKind: "scheduled" | "prn" | "interval"; scheduleJson: string };
      try {
        scheduleMeta = normalizeMedSchedule(body);
      } catch (e) {
        return c.json(
          { error: e instanceof Error ? e.message : "invalid_schedule" },
          400,
        );
      }

      const enc = encryptHealthTextFields(env, {
        name: body.name.trim(),
        dosage: body.dosage ?? null,
        instructions: body.instructions ?? null,
      });
      const visibility = normalizeHealthVisibility(body.visibility);
      const offsets =
        body.reminderOffsets?.filter((n) => typeof n === "number" && n >= 0) ?? [0];

      const [row] = await db
        .insert(healthMedications)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          name: enc.name!,
          dosage: enc.dosage ?? null,
          instructions: enc.instructions ?? null,
          scheduleKind: scheduleMeta.scheduleKind,
          scheduleJson: scheduleMeta.scheduleJson,
          reminderOffsetsJson: JSON.stringify(offsets),
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          enabled: body.enabled ?? true,
          visibility,
          createdByUserId: auth.userId,
        })
        .returning();

      let sharedMemberIds: string[] = [];
      if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
        sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthMedicationShares(db, row.id, sharedMemberIds);
      }

      return c.json(
        {
          medication: serializeHealthMedication(row, env, {
            sharedMemberIds,
            isOwnedByMe: true,
            canEdit: true,
            canLog: true,
          }),
        },
        201,
      );
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/medications/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, id), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const canWriteMed =
      existing.createdByUserId === auth.userId ||
      existing.visibility === "household" ||
      (await hasHealthSegmentAccess(db, auth, existing.memberId, "medications", "write"));
    if (existing.visibility === "private" && !canWriteMed) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      name?: string;
      dosage?: string | null;
      instructions?: string | null;
      scheduleKind?: string;
      schedule?: { times?: string[]; daysOfWeek?: number[] };
      reminderOffsets?: number[];
      startDate?: string | null;
      endDate?: string | null;
      enabled?: boolean;
      visibility?: string;
      sharedMemberIds?: string[];
      memberId?: string;
      /** Remove this medication from every group it belongs to (many-to-many — see
       *  health_medication_group_members). Leaving one specific group goes through
       *  DELETE /medication-groups/:id/members/:medicationId instead. */
      leaveAllGroups?: boolean;
    }>();

    try {
      const patch: Partial<typeof healthMedications.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = encryptHealthField(body.name, env) ?? "";
      if (body.dosage !== undefined) patch.dosage = encryptHealthField(body.dosage, env);
      if (body.instructions !== undefined) {
        patch.instructions = encryptHealthField(body.instructions, env);
      }
      if (body.scheduleKind !== undefined || body.schedule !== undefined) {
        try {
          const scheduleMeta = normalizeMedSchedule({
            scheduleKind: body.scheduleKind ?? existing.scheduleKind,
            schedule: body.schedule ?? parseMedSchedule(existing.scheduleJson),
          });
          patch.scheduleKind = scheduleMeta.scheduleKind;
          patch.scheduleJson = scheduleMeta.scheduleJson;
        } catch (e) {
          return c.json(
            { error: e instanceof Error ? e.message : "invalid_schedule" },
            400,
          );
        }
      }
      if (body.reminderOffsets !== undefined) {
        patch.reminderOffsetsJson = JSON.stringify(
          body.reminderOffsets.filter((n) => typeof n === "number" && n >= 0),
        );
      }
      if (body.startDate !== undefined) patch.startDate = body.startDate;
      if (body.endDate !== undefined) patch.endDate = body.endDate;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.visibility !== undefined) patch.visibility = normalizeHealthVisibility(body.visibility);
      if (body.memberId !== undefined) {
        if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "medications", "write"))) {
          return c.json({ error: "forbidden" }, 403);
        }
        patch.memberId = body.memberId;
      }

      const [row] = await db
        .update(healthMedications)
        .set(patch)
        .where(eq(healthMedications.id, id))
        .returning();

      if (body.sharedMemberIds !== undefined && row.visibility === "private") {
        const sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthMedicationShares(db, row.id, sharedMemberIds);
      }
      if (row.visibility === "household") {
        await replaceHealthMedicationShares(db, row.id, []);
      }
      if (body.leaveAllGroups) {
        await removeMedicationFromAllGroups(db, row.id);
      }

      const shareMap = await loadHealthMedicationShareMap(
        db,
        row.visibility === "private" ? [row.id] : [],
      );
      const groupMembershipMap = await loadHealthMedicationGroupMembershipMap(db, [row.id]);
      return c.json({
        medication: serializeHealthMedication(row, env, {
          sharedMemberIds: shareMap.get(row.id),
          isOwnedByMe: row.createdByUserId === auth.userId,
          canEdit: true,
          groupIds: groupMembershipMap.get(row.id) ?? [],
        }),
      });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/medications/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, id), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const canDelete =
      existing.createdByUserId === auth.userId ||
      (await hasHealthSegmentAccess(db, auth, existing.memberId, "medications", "write"));
    if (!canDelete) {
      return c.json({ error: "forbidden" }, 403);
    }
    await db.delete(healthMedications).where(eq(healthMedications.id, id));
    return c.json({ ok: true });
  });

  app.post("/medications/:id/log", async (c) => {
    const auth = c.get("auth")!;
    const medId = c.req.param("id");
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);
    const visible = await db
      .select({ id: healthMedications.id })
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), healthMedicationVisibleWhere(db, auth)))
      .limit(1);
    if (visible.length === 0) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "doses", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      status?: string;
      scheduledAt?: string;
      loggedAt?: string;
      notes?: string;
      alsoCreateEvent?: boolean;
    }>();

    const status = body.status === "skipped" || body.status === "missed" ? body.status : "taken";
    const isPrn = med.scheduleKind === "prn";
    const isInterval = med.scheduleKind === "interval";
    const alsoCreateEvent = body.alsoCreateEvent ?? isPrn;
    const loggedAt = body.loggedAt ? new Date(body.loggedAt) : new Date();
    let scheduledAt: Date | null = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!isPrn && !isInterval && !scheduledAt) {
      return c.json({ error: "scheduled_at_required" }, 400);
    }
    if (isInterval && !scheduledAt) {
      scheduledAt = loggedAt;
    }

    try {
      const { log, healthEventId, outcome } = await recordDose(db, env, {
        med,
        householdId: auth.householdId,
        loggedByUserId: auth.userId,
        status,
        scheduledAt,
        loggedAt,
        notes: body.notes,
        source: "single",
        alsoCreateEvent,
      });
      return c.json({ log, healthEventId, outcome }, 201);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.get("/medications/:id/logs", async (c) => {
    const auth = c.get("auth")!;
    const medId = c.req.param("id");
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);

    const visible = healthMedicationVisibleWhere(db, auth);
    const [check] = await db
      .select({ id: healthMedications.id })
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), visible!))
      .limit(1);
    if (!check) return c.json({ error: "not_found" }, 404);

    const logs = await db
      .select()
      .from(healthMedicationLogs)
      .where(eq(healthMedicationLogs.medicationId, medId))
      .orderBy(desc(healthMedicationLogs.loggedAt))
      .limit(100);

    return c.json({ logs: logs.map((l) => serializeHealthLog(l, env)) });
  });

  /**
   * Undo a dose log. A mistaken skip (or take) is otherwise permanent — "single" actions
   * overwrite each other but a group "take all" won't touch a logged dose, so there was no
   * way back. Deletes the log and the "Took <med>" event it spawned, if any.
   */
  app.delete("/medications/:id/logs/:logId", async (c) => {
    const auth = c.get("auth")!;
    const medId = c.req.param("id");
    const logId = c.req.param("logId");
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "doses", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [logRow] = await db
      .select()
      .from(healthMedicationLogs)
      .where(and(eq(healthMedicationLogs.id, logId), eq(healthMedicationLogs.medicationId, medId)))
      .limit(1);
    if (!logRow) return c.json({ error: "not_found" }, 404);

    await db.delete(healthMedicationLogs).where(eq(healthMedicationLogs.id, logId));
    if (logRow.healthEventId) {
      await db.delete(healthEvents).where(eq(healthEvents.id, logRow.healthEventId));
    }
    return c.json({ ok: true });
  });

  /**
   * Log several doses at once — the web "Take all" on an ad-hoc same-time slot, so it's one
   * request and one conflict-safe pass instead of an N-request client loop that could race a
   * just-tapped skip. `source: "bulk"`, so an already-logged dose in the batch is left alone.
   */
  app.post("/doses/batch", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      entries?: { medicationId?: string; scheduledAt?: string; status?: string }[];
      alsoCreateEvent?: boolean;
    }>();
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length === 0) return c.json({ error: "no_entries" }, 400);
    if (entries.length > 50) return c.json({ error: "too_many_entries" }, 400);

    const ids = [...new Set(entries.map((e) => e.medicationId).filter((v): v is string => !!v))];
    const meds = ids.length
      ? await db
          .select()
          .from(healthMedications)
          .where(and(inArray(healthMedications.id, ids), healthMedicationVisibleWhere(db, auth)!))
      : [];
    const medById = new Map(meds.map((m) => [m.id, m]));

    const loggedAt = new Date();
    const results: {
      medicationId: string;
      scheduledAt: string | null;
      outcome?: "inserted" | "updated" | "unchanged";
      log?: ReturnType<typeof serializeHealthLog>;
      error?: string;
    }[] = [];

    for (const entry of entries) {
      const med = entry.medicationId ? medById.get(entry.medicationId) : undefined;
      const scheduledAtRaw = entry.scheduledAt ?? null;
      if (!med) {
        results.push({ medicationId: entry.medicationId ?? "", scheduledAt: scheduledAtRaw, error: "not_found" });
        continue;
      }
      if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "doses", "write"))) {
        results.push({ medicationId: med.id, scheduledAt: scheduledAtRaw, error: "forbidden" });
        continue;
      }
      const status = entry.status === "skipped" || entry.status === "missed" ? entry.status : "taken";
      const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
      if (med.scheduleKind !== "prn" && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
        results.push({ medicationId: med.id, scheduledAt: scheduledAtRaw, error: "scheduled_at_required" });
        continue;
      }
      try {
        const { log, outcome } = await recordDose(db, env, {
          med,
          householdId: auth.householdId,
          loggedByUserId: auth.userId,
          status,
          scheduledAt,
          loggedAt,
          source: "bulk",
          alsoCreateEvent: body.alsoCreateEvent ?? false,
        });
        results.push({ medicationId: med.id, scheduledAt: log.scheduledAt, outcome, log });
      } catch (e) {
        const resp = encryptionErrorResponse(c, e);
        if (resp) return resp;
        results.push({
          medicationId: med.id,
          scheduledAt: scheduledAtRaw,
          error: e instanceof Error ? e.message : "log_failed",
        });
      }
    }
    return c.json({ results }, 201);
  });

  return app;
}
