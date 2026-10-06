import { memberShownLabel } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthMedicationPauses,
  healthMedicationShares,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthMemberAcl,
  healthOrganizerOccurrences,
  healthOrganizerPlanCaregivers,
  healthOrganizerPlans,
  healthOrganizerSessions,
  healthSupplyFillReminderSent,
  healthSupplyRefillReminderSent,
  healthSupplySettings,
  households,
  householdMembers,
  pushSubscriptions,
  users,
} from "@domi-ops/db";
import { and, eq, gte, inArray, isNotNull, isNull, max } from "drizzle-orm";
import {
  deriveOccurrence,
  isOrganizerOccurrenceDate,
  organizerOccurrenceDates,
  type OrganizerSchedule,
} from "./health-organizer-occurrences.js";
import { decryptReminderName, householdHasHealthModule } from "./health-reminder-shared.js";
import { effectiveLeadDays, estimateNeedsConfirmation } from "./health-supply-arithmetic.js";
import {
  FILL_REMINDER_LOOKBACK_DAYS,
  buildFillReminderCopy,
  buildFillReminderDeepLink,
  buildRefillReminderCopy,
  buildRefillReminderDeepLink,
  planFillReminder,
  planRefillReminder,
  type RefillReminderKind,
} from "./health-supply-reminder-plan.js";
import { addDaysIso, localDateOfInstant } from "./household-time.js";
import { deliverUserNotificationToSubscriptions, persistUserNotificationOnce, type PushSubscriptionDelivery } from "./user-notify.js";

/**
 * Reminders for pill organizer fills and medication refills (WHO-432, WHO-433). One scan per household, every 5 minutes.
 *
 * - **Fill**: on the appointment's day at the plan's reminder time, while it is still to do (not done, skipped, missed,
 *   resolved or moved to another day: a moved one reminds on its new day).
 * - **Refill**: at 9:00 household time on the deadline's day when the supply estimate says it is time and nobody has
 *   asked the pharmacy; a requested refill is silent except for one "still waiting" nudge two days before the supply
 *   runs out.
 * - Everything is worked out from what is true when the scan runs, so a medication paused, a refill requested, an
 *   appointment done or a caregiver whose access was taken away since the reminder was planned sends nothing, and a new
 *   supply estimate (a new revision) replaces the old one's pending reminder simply by being the current one.
 * - A reminder that came due while nothing was running goes on the next scan, once: each one is claimed in a table
 *   with a unique index before it is sent, so a retry or a second worker cannot send it twice.
 * - Recipients are the plan's selected caregivers (the person when they have no plan), each rechecked for access now.
 *   Everyone gets an inbox notice; a push goes to their devices too where their health reminders setting is on.
 */

type Member = { memberId: string; userId: string; role: string; name: string | null };

type Acl = { medicationsAccess: string; dosesAccess: string };

const isAdminRole = (role: string) => role === "owner" || role === "admin";

/** May this person read the subject's medications at all (the same gate as the organizer and supply routes)? */
function mayReadMedications(recipient: Member, subjectMemberId: string, acl: Map<string, Acl>): boolean {
  if (recipient.memberId === subjectMemberId || isAdminRole(recipient.role)) return true;
  const grants = acl.get(recipient.memberId);
  return grants !== undefined && (grants.medicationsAccess === "read" || grants.medicationsAccess === "write" || grants.dosesAccess === "write");
}

/** Whether one medication is visible to the person: household ones to everyone, private ones only by the usual routes (no admin override). */
function medicationVisibleTo(
  recipient: Member,
  med: { id: string; memberId: string; visibility: string; createdByUserId: string | null },
  acl: Map<string, Acl>,
  sharedWith: ReadonlySet<string>,
): boolean {
  if (med.visibility === "household") return true;
  if (recipient.memberId === med.memberId || med.createdByUserId === recipient.userId || sharedWith.has(recipient.memberId)) return true;
  const grants = acl.get(recipient.memberId);
  return grants !== undefined && (grants.medicationsAccess === "read" || grants.medicationsAccess === "write" || grants.dosesAccess === "write");
}

export async function scanHealthSupplyReminders(
  db: Database,
  env: Env,
  opts: { now?: Date; householdId?: string } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const householdRows = await db
    .select({ id: households.id, modulesEnabled: households.modulesEnabled, timezone: households.timezone })
    .from(households)
    .where(opts.householdId ? eq(households.id, opts.householdId) : undefined);

  let sent = 0;
  for (const household of householdRows.filter((h) => householdHasHealthModule(h.modulesEnabled))) {
    const timeZone = household.timezone ?? "UTC";
    sent += await scanHousehold(db, env, { householdId: household.id, timeZone, now });
  }
  return sent;
}

async function scanHousehold(db: Database, env: Env, ctx: { householdId: string; timeZone: string; now: Date }): Promise<number> {
  const { householdId, timeZone, now } = ctx;
  const today = localDateOfInstant(now, timeZone);

  const memberRows = await db
    .select({ memberId: householdMembers.id, userId: householdMembers.userId, role: householdMembers.role, name: householdMembers.name })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
  const members = new Map<string, Member>(memberRows.map((m) => [m.memberId, m]));

  const plans = await db
    .select()
    .from(healthOrganizerPlans)
    .where(and(eq(healthOrganizerPlans.householdId, householdId), isNull(healthOrganizerPlans.archivedAt)));
  const caregiverRows = plans.length
    ? await db.select().from(healthOrganizerPlanCaregivers).where(inArray(healthOrganizerPlanCaregivers.planId, plans.map((p) => p.id)))
    : [];
  const caregiversOfMember = new Map<string, string[]>();
  for (const plan of plans) {
    caregiversOfMember.set(plan.memberId, caregiverRows.filter((c) => c.planId === plan.id).map((c) => c.memberId));
  }

  const aclRows = await db
    .select({
      subjectMemberId: healthMemberAcl.subjectMemberId,
      granteeMemberId: healthMemberAcl.granteeMemberId,
      medicationsAccess: healthMemberAcl.medicationsAccess,
      dosesAccess: healthMemberAcl.dosesAccess,
    })
    .from(healthMemberAcl)
    .where(eq(healthMemberAcl.householdId, householdId));
  const aclOf = (subjectMemberId: string): Map<string, Acl> =>
    new Map(aclRows.filter((r) => r.subjectMemberId === subjectMemberId).map((r) => [r.granteeMemberId, r]));

  /**
   * The people to remind about this person's organizer or medications: the plan's selected caregivers (leaving everyone
   * unticked is a choice for no reminders), or the person themself when they have no organizer plan.
   */
  const recipientsFor = (subjectMemberId: string): Member[] => {
    const ids = caregiversOfMember.get(subjectMemberId) ?? [subjectMemberId];
    return ids.map((id) => members.get(id)).filter((m): m is Member => m !== undefined);
  };

  /** Everyone who gets a push: the person has the health reminders setting on. The inbox notice is for everyone. */
  const pushUsers = new Set<string>();
  const subsByUser = new Map<string, PushSubscriptionDelivery[]>();
  const loadDelivery = async (userIds: string[]) => {
    const need = userIds.filter((id) => !subsByUser.has(id));
    if (need.length === 0) return;
    const [settings, subs] = await Promise.all([
      db.select({ id: users.id, push: users.pushHealthRemindersEnabled }).from(users).where(inArray(users.id, need)),
      db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, need)),
    ]);
    for (const s of settings) if (s.push) pushUsers.add(s.id);
    for (const id of need) subsByUser.set(id, []);
    for (const sub of subs) {
      subsByUser.get(sub.userId)!.push({
        id: sub.id,
        userId: sub.userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        authKey: sub.authKey,
        platform: sub.platform,
        deviceToken: sub.deviceToken,
      });
    }
  };

  const deliver = async (input: { userId: string; title: string; body: string; url: string; tag: string }) => {
    await loadDelivery([input.userId]);
    const subscriptions = pushUsers.has(input.userId) ? (subsByUser.get(input.userId) ?? []) : [];
    if (subscriptions.length > 0) {
      await deliverUserNotificationToSubscriptions(db, env, { ...input, householdId, subscriptions });
    } else {
      await persistUserNotificationOnce(db, { ...input, householdId });
    }
  };

  let sent = 0;

  // ── Fill appointments ────────────────────────────────────────────────────────
  if (plans.length > 0) {
    const from = addDaysIso(today, -FILL_REMINDER_LOOKBACK_DAYS);
    const to = addDaysIso(today, 1);
    const planIds = plans.map((p) => p.id);
    const [rows, sessions] = await Promise.all([
      db
        .select()
        .from(healthOrganizerOccurrences)
        .where(and(inArray(healthOrganizerOccurrences.planId, planIds), gte(healthOrganizerOccurrences.occurrenceDate, addDaysIso(today, -400)))),
      db
        .select({ planId: healthOrganizerSessions.planId, occurrenceId: healthOrganizerSessions.occurrenceId, finishedAt: healthOrganizerSessions.finishedAt })
        .from(healthOrganizerSessions)
        .where(and(inArray(healthOrganizerSessions.planId, planIds), eq(healthOrganizerSessions.status, "finished"))),
    ]);

    for (const plan of plans) {
      const schedule: OrganizerSchedule =
        plan.scheduleKind === "every_n_days" ? { kind: "every_n_days", everyN: plan.everyN as number } : { kind: "monthly_date", monthlyDay: plan.monthlyDay as number };
      const mine = rows.filter((r) => r.planId === plan.id);
      const byNominal = new Map(mine.map((r) => [r.occurrenceDate, r]));
      const planSessions = sessions.filter((s) => s.planId === plan.id);
      const finishedLinked = new Set(planSessions.filter((s) => s.occurrenceId).map((s) => s.occurrenceId as string));
      const finishedDates = planSessions.filter((s) => !s.occurrenceId && s.finishedAt).map((s) => (s.finishedAt as Date).toLocaleDateString("en-CA", { timeZone }));

      // The schedule's own days in the window, plus appointments moved into it from outside.
      const nominal = new Set(organizerOccurrenceDates(schedule, plan.anchorDate, from, to));
      for (const r of mine) {
        if (r.outcome === "rescheduled" && r.rescheduledTo && r.rescheduledTo >= from && r.rescheduledTo <= to && isOrganizerOccurrenceDate(schedule, plan.anchorDate, r.occurrenceDate)) {
          nominal.add(r.occurrenceDate);
        }
      }

      const subject = members.get(plan.memberId);
      const subjectLabel = memberShownLabel({ name: subject?.name ?? null }) || "Member";
      const reminderTime = String(plan.reminderTime);

      for (const nominalDate of [...nominal].sort()) {
        const row = byNominal.get(nominalDate);
        const outcome = (row?.outcome ?? "pending") as "pending" | "done" | "skipped" | "missed" | "rescheduled";
        const date = outcome === "rescheduled" && row?.rescheduledTo ? row.rescheduledTo : nominalDate;
        // Someone has looked at an overdue appointment and said they have dealt with it: no more nagging.
        if (row?.resolvedAt) continue;
        const { status } = deriveOccurrence({
          outcome,
          date,
          now,
          timeZone,
          linkedSessionFinished: row ? finishedLinked.has(row.id) : false,
          sessionFinishedDates: finishedDates,
        });
        const decision = planFillReminder({ status, date, reminderTime, timeZone, now });
        if (!decision.due) continue;

        const acl = aclOf(plan.memberId);
        for (const recipient of recipientsFor(plan.memberId)) {
          if (!mayReadMedications(recipient, plan.memberId, acl)) continue;
          const [claimed] = await db
            .insert(healthSupplyFillReminderSent)
            .values({ planId: plan.id, occurrenceDate: nominalDate, userId: recipient.userId })
            .onConflictDoNothing()
            .returning({ id: healthSupplyFillReminderSent.id });
          if (!claimed) continue;
          const { title, body } = buildFillReminderCopy({ isSubject: recipient.memberId === plan.memberId, subjectLabel, late: decision.late });
          await deliver({
            userId: recipient.userId,
            title,
            body,
            url: buildFillReminderDeepLink({ planId: plan.id, occurrenceDate: nominalDate, memberId: plan.memberId }),
            tag: `health-fill-${plan.id}-${nominalDate}`,
          });
          sent += 1;
        }
      }
    }
  }

  // ── Refills ──────────────────────────────────────────────────────────────────
  const meds = await db
    .select()
    .from(healthMedications)
    .where(and(eq(healthMedications.householdId, householdId), eq(healthMedications.enabled, true), isNull(healthMedications.deletedAt)));
  if (meds.length === 0) return sent;

  const medIds = meds.map((m) => m.id);
  const supplyRows = await db
    .select()
    .from(healthMedicationSupply)
    .where(and(inArray(healthMedicationSupply.medicationId, medIds), isNotNull(healthMedicationSupply.runsOutOn)));
  if (supplyRows.length === 0) return sent;

  const withEstimate = supplyRows.map((r) => r.medicationId);
  const memberIds = [...new Set(meds.map((m) => m.memberId))];
  const [settingRows, madeRows, pauseRows, shareRows] = await Promise.all([
    db.select({ memberId: healthSupplySettings.memberId, days: healthSupplySettings.defaultLeadDays }).from(healthSupplySettings).where(inArray(healthSupplySettings.memberId, memberIds)),
    db
      .select({ medicationId: healthMedicationSupplyRevisions.medicationId, at: max(healthMedicationSupplyRevisions.createdAt) })
      .from(healthMedicationSupplyRevisions)
      .where(inArray(healthMedicationSupplyRevisions.medicationId, withEstimate))
      .groupBy(healthMedicationSupplyRevisions.medicationId),
    db.select().from(healthMedicationPauses).where(inArray(healthMedicationPauses.medicationId, withEstimate)),
    db
      .select({ medicationId: healthMedicationShares.medicationId, memberId: healthMedicationShares.memberId })
      .from(healthMedicationShares)
      .where(inArray(healthMedicationShares.medicationId, medIds)),
  ]);
  const leadByMember = new Map(settingRows.map((s) => [s.memberId, s.days]));
  const madeAt = new Map(madeRows.filter((r) => r.at !== null).map((r) => [r.medicationId, r.at as Date]));
  const medById = new Map(meds.map((m) => [m.id, m]));

  for (const row of supplyRows) {
    const med = medById.get(row.medicationId);
    if (!med || !row.runsOutOn) continue;
    const made = madeAt.get(med.id);
    const pauses = pauseRows.filter((p) => p.medicationId === med.id).map((p) => ({ pausedAt: p.pausedAt, resumedAt: p.resumedAt }));
    const kind: RefillReminderKind | null = planRefillReminder({
      runsOutOn: row.runsOutOn,
      leadDays: effectiveLeadDays(row.leadDays, leadByMember.get(med.memberId)),
      medicationEndDate: med.endDate,
      active: med.enabled && med.deletedAt === null,
      requested: row.requestedAt !== null,
      needsConfirmation: made !== undefined && estimateNeedsConfirmation(made, pauses),
      timeZone,
      now,
    });
    if (!kind) continue;

    const subject = members.get(med.memberId);
    const subjectLabel = memberShownLabel({ name: subject?.name ?? null }) || "Member";
    const medicationName = decryptReminderName(med.name, env, "Medication");
    const acl = aclOf(med.memberId);
    const sharedWith = new Set(shareRows.filter((s) => s.medicationId === med.id).map((s) => s.memberId));

    for (const recipient of recipientsFor(med.memberId)) {
      // Both gates, now: the person may read this person's medications, and may see this one.
      if (!mayReadMedications(recipient, med.memberId, acl) || !medicationVisibleTo(recipient, med, acl, sharedWith)) continue;
      const [claimed] = await db
        .insert(healthSupplyRefillReminderSent)
        .values({ medicationId: med.id, revision: row.revision, kind, userId: recipient.userId })
        .onConflictDoNothing()
        .returning({ id: healthSupplyRefillReminderSent.id });
      if (!claimed) continue;
      const { title, body } = buildRefillReminderCopy({
        kind,
        medicationName,
        runsOutOn: row.runsOutOn,
        isSubject: recipient.memberId === med.memberId,
        subjectLabel,
        now,
        timeZone,
      });
      await deliver({
        userId: recipient.userId,
        title,
        body,
        url: buildRefillReminderDeepLink({ medicationId: med.id }),
        tag: `health-refill-${med.id}-${row.revision}-${kind}`,
      });
      sent += 1;
    }
  }

  return sent;
}
