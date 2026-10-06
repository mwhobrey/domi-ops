/**
 * Google Calendar sync engine (v1).
 * Port logic from HomeHub app/google_calendar/* — import-first default,
 * manual pull, optional bidirectional. Worker invokes these jobs.
 */

export type SyncMode = "import_only" | "manual" | "bidirectional";

export type SyncJobName =
  | "google.calendar.pull"
  | "google.calendar.push"
  | "google.calendar.full_import"
  | "recurring.materialize"
  | "calendar.reminder.scan"
  | "chore.reminder.scan"
  | "expense.budget.scan"
  | "school.reminder.scan"
  | "chore.digest.scan"
  | "drive.quota.scan"
  | "health.med.reminder.scan"
  | "health.med.reminder.household"
  | "health.check.reminder.scan"
  | "health.check.reminder.household"
  | "calendar.reminder.household"
  | "chore.reminder.household"
  | "chore.digest.household"
  | "expense.budget.household"
  | "school.reminder.household"
  | "drive.quota.household"
  | "myallyfile.sync.scan";

export interface SyncJobPayload {
  householdId: string;
  connectionId?: string;
  linkedCalendarId?: string;
  userId?: string;
}

export {
  SYNC_QUEUE,
  enqueueSyncJob,
  getSyncQueue,
  ensureCalendarReminderScheduler,
  ensureChoreReminderScheduler,
  ensureExpenseBudgetScheduler,
  ensureSchoolReminderScheduler,
  ensureChoreDigestScheduler,
  ensureDriveQuotaScheduler,
  ensureHealthMedReminderScheduler,
  ensureHealthCheckReminderScheduler,
  ensureMyallyfileSyncScheduler,
  householdScanEnqueuer,
} from "./queue.js";
export { runCalendarSyncJob, syncConnection, pullLinkedCalendar } from "./sync.js";
export { eventToFields, eventToGoogleBody, inferSourceCategory } from "./mapper.js";
export { processOutboxForConnection, pushEventUpdate, pushEventCreate } from "./push.js";
export {
  materializeRecurringForHousehold,
  occurrenceDates,
  parseRrule,
  type ParsedRrule,
} from "./recurring.js";
export { scanCalendarReminders } from "./reminder-scan.js";
export { scanChoreReminders } from "./chore-reminder-scan.js";
export { scanChoreDigest, CHORE_DIGEST_HOUR } from "./chore-digest-scan.js";
export { scanDriveQuotaWarnings } from "./drive-quota-scan.js";
export { deliverUserNotification, persistUserNotifications, persistUserNotificationOnce, deliverUserNotificationToSubscriptions } from "./user-notify.js";
export { isValidTimeZone, resolveAlertTimeZone } from "./alert-timezone.js";
export {
  parseIntervalSchedule,
  normalizeIntervalSchedule,
  nextIntervalPending,
  intervalDoseInWindow,
  intervalSlotShiftsForEdit,
  type IntervalSchedule,
  type IntervalLog,
  type IntervalPendingDose,
  type IntervalEditLog,
} from "./med-interval-schedule.js";
export { datesBetween, loadCheckSlotStatuses } from "./health-check-status.js";
export { groupCoversCheckSlot } from "./health-check-group-reminders.js";
export { parseCheckTemplate, type CheckTemplate } from "./health-check-template.js";
export {
  CHECK_SLOT_TOLERANCE_MINUTES,
  CHECK_SLOT_TOLERANCE_MS,
  computeSlotStatuses,
  eventQualifiesForCheck,
  excludeInactiveInstants,
  intervalCheckSlots,
  matchEventsToSlots,
  scheduledCheckSlots,
  type CheckForSlots,
  type CheckSlotEvent,
  type CheckSlotLog,
  type PausePeriod,
  type SlotResult,
  type SlotStatus,
} from "./health-check-slots.js";
export {
  expandScheduledSlots,
  parseFixedTimeSchedule,
  scheduleHhmm,
  type FixedTimeSchedule,
  type ScheduledSlot,
} from "./health-schedule.js";
export {
  MAX_ORGANIZER_DAYS,
  addDaysUtc,
  computePlacements,
  formatQuarters,
  type MedicationPlacementSummary,
  type NotGuided,
  type NotGuidedReason,
  type OrganizerCompartment,
  type OrganizerGroup,
  type OrganizerMedication,
  type Placement,
  type PlacementInput,
  type PlacementProblem,
  type PlacementResult,
} from "./health-organizer-placements.js";
export {
  DEFAULT_LEAD_DAYS,
  MAX_LEAD_DAYS,
  MAX_SUPPLY_DAYS,
  REFILL_REMINDER_TIME,
  computeSupply,
  daysBetween,
  daysRemaining,
  effectiveLeadDays,
  estimateNeedsConfirmation,
  mergeRanges,
  organizerCoverage,
  refillDeadline,
  refillReminderAt,
  refillStatus,
  type DateRange,
  type OrganizerCoverage,
  type RefillState,
  type RefillStatus,
  type SupplyEstimate,
} from "./health-supply-arithmetic.js";
export {
  MAX_OCCURRENCE_DATES,
  deriveOccurrence,
  isOrganizerOccurrenceDate,
  nextOrganizerOccurrenceAfter,
  organizerOccurrenceDates,
  organizerOccurrenceWindow,
  type DerivedOccurrence,
  type OccurrenceStatus,
  type OccurrenceWindow,
  type OrganizerSchedule,
} from "./health-organizer-occurrences.js";
export { scanSchoolReminders } from "./school-reminder-scan.js";
export { scanHealthMedReminders } from "./health-med-reminder-scan.js";
export { fanOutCheckReminderScans, fanOutMedReminderScans } from "./health-reminder-fanout.js";
export {
  HOUSEHOLD_SCAN_INTERVAL_MS,
  enqueueForHouseholds,
  householdScanJobId,
  type EnqueueHouseholdScan,
  type HouseholdScanJob,
} from "./household-scan-fanout.js";
export {
  fanOutBudgetAlertScans,
  fanOutCalendarReminderScans,
  fanOutChoreDigestScans,
  fanOutChoreReminderScans,
  fanOutDriveQuotaScans,
  fanOutSchoolReminderScans,
} from "./scan-fanout.js";
export {
  OVERDUE_NUDGE_AFTER_MINUTES,
  buildCheckReminderCopy,
  buildCheckReminderDeepLink,
  planCheckReminders,
  scanHealthCheckReminders,
  type CheckReminderKind,
} from "./health-check-reminder-scan.js";
export {
  MyallyfileError,
  MYALLYFILE_MAX_MEDICATIONS,
  buildMedSnapshot,
  decryptMyallyfileSecret,
  encryptMyallyfileSecret,
  markMyallyfileSyncNeeded,
  myallyfileExchangeLinkCode,
  myallyfileRevokeLink,
  scanMyallyfileSync,
  shapeSnapshot,
  snapshotHash,
  type MyallyfileErrorCode,
  type SnapshotMedication,
} from "./myallyfile-sync.js";
export { checkHouseholdBudgetAlerts, scanBudgetAlerts } from "./budget-alert-scan.js";
export {
  inferGoogleCategories,
  inferSourceCategoryLabel,
  eventCategoryColor,
  applyCategoryMapping,
  normalizeCategorySourceKey,
  type InferredCategory,
} from "./categories.js";
export {
  setSyncRun,
  parseSyncRunProgress,
  type SyncRunStatus,
  type SyncRunProgress,
} from "./sync-run.js";
export {
  dedupeHouseholdGoogleEvents,
  findExistingGoogleEvent,
  findFuzzyGoogleEventMatch,
} from "./google-event-match.js";
export {
  normalizeReminderOffsets,
  replaceEventReminders,
  listReminderOffsetsForEvent,
  offsetsFromGoogleEvent,
  googleRemindersBody,
  REMINDER_PRESET_OFFSETS,
  MAX_REMINDER_OFFSET_MINUTES,
  reminderOffsetLabel,
} from "./event-reminders.js";
export { calendarReminderRecipientUserIds } from "./calendar-recipients.js";
export {
  todayIsoDateInTz,
  eventStartInstant,
  ALL_DAY_REMINDER_HOUR,
  addDaysIso,
  classifyDueReminder,
  localHourInTz,
  localTimeHhmm,
  isMidnightInTz,
  formatTimeLabelInTz,
  OVERDUE_REMINDER_COOLDOWN_MS,
  reportWeekRange,
  mondayOfWeekIso,
  isoDateInRange,
  isoWeekday,
  localDateOfInstant,
  zonedLocalToUtc,
  weeksOverlappingRange,
  MAX_WEEKS_IN_RANGE,
  type DueReminderKind,
  type ReportWeekRange,
} from "./household-time.js";
export { listGoogleCalendars, ensureAccessToken, CalendarCredentialsError } from "./client.js";

/** Job handlers registered by apps/worker */
export type SyncJobHandler = (payload: SyncJobPayload) => Promise<void>;

const handlers = new Map<SyncJobName, SyncJobHandler>();

export function registerSyncHandler(name: SyncJobName, handler: SyncJobHandler): void {
  handlers.set(name, handler);
}

export async function runSyncJob(
  name: SyncJobName,
  payload: SyncJobPayload,
): Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(
      `No handler for ${name}. Implement in worker (port from HomeHub google_calendar/sync.py).`,
    );
  }
  await handler(payload);
}
