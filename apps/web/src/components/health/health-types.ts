/**
 * Shared types + option lists for the Health module's UI — extracted out of the
 * HealthPageClient.tsx monolith (2026-08-30) so sibling components (MedicationManagerClient,
 * HealthSharingClient) don't have to reach sideways into a component file for a type.
 */

import type { PharmacySummary, SupplySummary } from "./supply-types";

export type HealthEventType =
  | "sickness"
  | "injury"
  | "appointment"
  | "symptom"
  | "medication"
  | "vitals"
  | "exercise"
  | "pain"
  | "food_intake"
  | "other";

export type VitalsMetric =
  | "weight"
  | "height"
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "heart_rate"
  | "temperature"
  | "blood_oxygen"
  | "blood_glucose"
  | "respiratory_rate"
  | "other";

export interface VitalsReading {
  id?: string;
  metric: VitalsMetric;
  value: number;
  unit: string;
}

export interface ExerciseDetail {
  id?: string;
  activity: string;
  durationMinutes: number | null;
  intensity: string | null;
  distance: number | null;
  distanceUnit: string | null;
  sets: number | null;
  reps: number | null;
  caloriesEstimated: number | null;
}

/** Form-state mirror of ExerciseDetail — numeric fields stay strings while typing. */
export type ExerciseDetailDraft = {
  activity: string;
  durationMinutes: string;
  intensity: string;
  distance: string;
  distanceUnit: string;
  sets: string;
  reps: string;
  caloriesEstimated: string;
};

export interface FoodLogEntry {
  id?: string;
  foodName: string;
  quantity: number | null;
  unit: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/** Form-state mirror of FoodLogEntry — numeric fields stay strings while typing. */
export type FoodLogEntryDraft = {
  key: string;
  foodName: string;
  quantity: string;
  unit: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

export interface HealthEvent {
  id: string;
  memberId: string;
  medicationId: string | null;
  type: HealthEventType;
  title: string;
  notes: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationKind?: "single_day" | "ongoing";
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  visibility: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  canEdit?: boolean;
  readings?: VitalsReading[];
  exerciseDetails?: ExerciseDetail[];
  painLogs?: PainLog[];
  foodLogEntries?: FoodLogEntry[];
}

export interface HealthMedication {
  id: string;
  memberId: string;
  /** Groups this medication belongs to — many-to-many (a med taken multiple times a day can
   *  have different doses in different groups), so this is an array, not a single id. */
  groupIds?: string[];
  name: string;
  dosage: string | null;
  instructions: string | null;
  /** pill unless said otherwise; only pills go in a pill organizer (WHO-445). */
  form?: MedicationFormValue;
  scheduleKind: "scheduled" | "prn" | "otc" | "interval";
  schedule: {
    times?: string[];
    daysOfWeek?: number[];
    everyMinutes?: number;
    anchor?: string;
    fixedStartTime?: string;
    intervalFrom?: string;
    stop?: { mode?: string; maxDoses?: number; endTime?: string };
  };
  reminderOffsets: number[];
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
  visibility: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  canEdit?: boolean;
  canLog?: boolean;
  /** Pills per dose time ("08:00": 1.5), for the pill organizer (WHO-417). */
  doseQuantities?: Record<string, number>;
  /** Scheduled times with no amount yet, and amounts left over from times the medication no longer takes. */
  doseQuantityIssues?: { missing: string[]; orphaned: string[] };
  /** Supply estimate and pharmacy (WHO-419). Both are absent until something about supply is set. */
  supply?: SupplySummary;
  pharmacy?: PharmacySummary | null;
}

export interface PendingDose {
  medicationId: string;
  name: string;
  dosage?: string | null;
  scheduledAt: string;
  scheduledTime: string;
  scheduledTimeLabel: string;
  memberId: string;
  awaitingFirst?: boolean;
}

/** Minimal shape HealthMedicationSheet's group picker needs — full MedicationGroup type lives
 *  in components/health/MedicationManagerClient.tsx, this avoids a circular import. */
export interface MedicationGroupOption {
  id: string;
  memberId: string;
  name: string;
}

export interface PendingGroupDose {
  groupId: string;
  name: string;
  scheduledAt: string;
  scheduledTime: string;
  scheduledTimeLabel: string;
  memberId: string;
  medications: { medicationId: string; name: string; dosage: string | null; alreadyLogged: boolean }[];
}

export interface LoggedDose {
  logId: string;
  medicationId: string;
  name: string;
  dosage?: string | null;
  memberId: string;
  status: "taken" | "skipped" | "missed";
  scheduledAt: string | null;
  scheduledTimeLabel: string | null;
  loggedAt: string;
  loggedAtLabel: string;
}

export type TodayEntry =
  | { kind: "adhoc"; scheduledTime: string; timeGroup: { scheduledTime: string; label: string; doses: PendingDose[] } }
  | { kind: "group"; scheduledTime: string; group: PendingGroupDose };

export type VitalsReadingDraft = { key: string; metric: VitalsMetric; value: string; unit: string };

export const EVENT_TYPES: { value: HealthEventType; label: string }[] = [
  { value: "sickness", label: "Sickness" },
  { value: "injury", label: "Injury" },
  { value: "appointment", label: "Appointment" },
  { value: "symptom", label: "Symptom" },
  { value: "medication", label: "Medication" },
  { value: "vitals", label: "Vitals" },
  { value: "exercise", label: "Exercise" },
  { value: "pain", label: "Pain" },
  { value: "food_intake", label: "Meal" },
  { value: "other", label: "Other" },
];

export const EXERCISE_INTENSITIES: { value: string; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "moderate", label: "Moderate" },
  { value: "vigorous", label: "Vigorous" },
];

export function emptyExerciseDetailDraft(): ExerciseDetailDraft {
  return {
    activity: "",
    durationMinutes: "",
    intensity: "",
    distance: "",
    distanceUnit: "",
    sets: "",
    reps: "",
    caloriesEstimated: "",
  };
}

export const VITALS_METRICS: { value: VitalsMetric; label: string; defaultUnit: string }[] = [
  { value: "weight", label: "Weight", defaultUnit: "lb" },
  { value: "height", label: "Height", defaultUnit: "in" },
  { value: "blood_pressure_systolic", label: "BP systolic", defaultUnit: "mmHg" },
  { value: "blood_pressure_diastolic", label: "BP diastolic", defaultUnit: "mmHg" },
  { value: "heart_rate", label: "Heart rate", defaultUnit: "bpm" },
  { value: "temperature", label: "Temperature", defaultUnit: "°F" },
  { value: "blood_oxygen", label: "Blood oxygen", defaultUnit: "%" },
  { value: "blood_glucose", label: "Blood glucose", defaultUnit: "mg/dL" },
  { value: "respiratory_rate", label: "Respiratory rate", defaultUnit: "breaths/min" },
  { value: "other", label: "Other", defaultUnit: "" },
];

/** Most-logged vitals, pre-filled empty so the common case is just typing numbers. */
export const DEFAULT_VITALS_METRICS: VitalsMetric[] = [
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "heart_rate",
];

/** One-tap adds under the readings list — situational metrics that don't earn a default row. */
export const QUICK_ADD_VITALS_METRICS: VitalsMetric[] = ["temperature", "blood_oxygen", "weight"];

/**
 * Front/back body-map regions for pain logging (WHO-297/298) — mirrors the
 * health_pain_body_region Postgres enum in packages/db/src/schema/health.ts. Shoulders, upper
 * arms, forearms, hands, and feet are clickable from either view and share one region value;
 * the back view additionally distinguishes hamstring/calf from the front-only thigh/shin.
 */
export type HealthPainBodyRegion =
  | "front_head"
  | "face"
  | "neck_front"
  | "chest"
  | "abdomen"
  | "groin"
  | "left_shoulder"
  | "right_shoulder"
  | "left_upper_arm"
  | "right_upper_arm"
  | "left_forearm"
  | "right_forearm"
  | "left_hand"
  | "right_hand"
  | "left_thigh"
  | "right_thigh"
  | "left_shin"
  | "right_shin"
  | "left_foot"
  | "right_foot"
  | "back_head"
  | "neck_back"
  | "upper_back"
  | "lower_back"
  | "buttocks"
  | "left_shoulder_blade"
  | "right_shoulder_blade"
  | "left_hamstring"
  | "right_hamstring"
  | "left_calf"
  | "right_calf"
  | "left_chest"
  | "right_chest"
  | "spine";

export const PAIN_BODY_REGION_LABELS: Record<HealthPainBodyRegion, string> = {
  front_head: "Top of head",
  face: "Face",
  neck_front: "Neck (front)",
  chest: "Chest",
  abdomen: "Abdomen",
  groin: "Groin",
  left_shoulder: "Left shoulder",
  right_shoulder: "Right shoulder",
  left_upper_arm: "Left upper arm",
  right_upper_arm: "Right upper arm",
  left_forearm: "Left forearm",
  right_forearm: "Right forearm",
  left_hand: "Left hand",
  right_hand: "Right hand",
  left_thigh: "Left thigh",
  right_thigh: "Right thigh",
  left_shin: "Left shin",
  right_shin: "Right shin",
  left_foot: "Left foot",
  right_foot: "Right foot",
  back_head: "Back of head",
  neck_back: "Neck (back)",
  upper_back: "Upper back",
  lower_back: "Lower back",
  buttocks: "Buttocks",
  left_shoulder_blade: "Left shoulder blade",
  right_shoulder_blade: "Right shoulder blade",
  left_hamstring: "Left hamstring",
  right_hamstring: "Right hamstring",
  left_calf: "Left calf",
  right_calf: "Right calf",
  left_chest: "Left chest",
  right_chest: "Right chest",
  spine: "Spine",
};

export type PainLogDraft = {
  key: string;
  region: HealthPainBodyRegion;
  severity: number;
  /** Not editable in the UI yet — carried through so a round trip doesn't silently drop it. */
  qualityTags?: string[] | null;
};

/** Matches the API's SerializedPainLog shape — distinct from PainLogDraft, same split as
 *  VitalsReading vs VitalsReadingDraft. */
export interface PainLog {
  id?: string;
  bodyRegion: HealthPainBodyRegion;
  severity: number;
  qualityTags?: string[] | null;
}

/** A structured dose log, merged into the Log tab alongside health events. */
export interface DoseLogEntry {
  id: string;
  medicationId: string;
  medicationName: string;
  dosage: string | null;
  memberId: string;
  status: "taken" | "skipped" | "missed";
  scheduledAt: string | null;
  loggedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Scheduled health checks (WHO-379..): "log Ally's BP at 8, 12, 4 and 8"
// ---------------------------------------------------------------------------------------------

/** Mirrors the API's template: what to prompt for when this check is logged. */
export interface HealthCheckTemplate {
  title?: string;
  metrics?: string[];
  regions?: string[];
  activity?: string;
}

/** The API's SerializedHealthCheck, as far as the Today tab needs it. */
export interface HealthCheck {
  id: string;
  memberId: string;
  groupIds: string[];
  name: string;
  eventType: HealthEventType;
  template: HealthCheckTemplate;
  scheduleKind: "scheduled" | "interval" | string;
  schedule?: {
    times?: string[];
    daysOfWeek?: number[];
    everyMinutes?: number;
    anchor?: string;
    fixedStartTime?: string;
    intervalFrom?: string;
    stop?: { mode?: string; maxDoses?: number; endTime?: string };
  };
  reminderOffsets?: number[];
  startDate?: string | null;
  endDate?: string | null;
  enabled: boolean;
  visibility?: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  /** `events: write` on the person: may log, skip and undo. */
  canLog?: boolean;
  canEdit?: boolean;
}

export type CheckSlotStatus = "done" | "skipped" | "missed" | "due" | "overdue" | "upcoming";

export interface CheckSlot {
  scheduledAt: string;
  status: CheckSlotStatus;
  source: "log" | "event" | null;
  logId: string | null;
  /** The completing entry, only when the viewer may open it. */
  eventId: string | null;
}

/** One line on the Today tab: a slot of a check. */
export interface CheckSlotRow {
  check: HealthCheck;
  slot: CheckSlot;
}

/** The API's SerializedHealthCheckGroup: a bundle of one person's checks that share reminders. */
export interface HealthCheckGroup {
  id: string;
  memberId: string;
  name: string;
  scheduleKind: "scheduled" | "interval" | string;
  schedule?: HealthCheck["schedule"];
  reminderOffsets?: number[];
  startDate?: string | null;
  endDate?: string | null;
  enabled: boolean;
  visibility?: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  canEdit?: boolean;
  /** Only the member checks the viewer is allowed to see. */
  checks: HealthCheck[];
}

export type MedicationFormValue = "pill" | "iv" | "injection" | "liquid" | "other";

export const MEDICATION_FORMS: ReadonlyArray<{ value: MedicationFormValue; label: string }> = [
  { value: "pill", label: "Pill or tablet" },
  { value: "iv", label: "IV" },
  { value: "injection", label: "Injection" },
  { value: "liquid", label: "Liquid" },
  { value: "other", label: "Other" },
];
