/**
 * Shared types + option lists for the Health module's UI — extracted out of the
 * HealthPageClient.tsx monolith (2026-08-30) so sibling components (MedicationManagerClient,
 * HealthSharingClient) don't have to reach sideways into a component file for a type.
 */

export type HealthEventType =
  | "sickness"
  | "injury"
  | "appointment"
  | "symptom"
  | "medication"
  | "vitals"
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
  scheduleKind: "scheduled" | "prn" | "interval";
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
  { value: "other", label: "Other" },
];

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
  "temperature",
];
