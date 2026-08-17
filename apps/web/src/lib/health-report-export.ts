export type HealthReportGroupBy = "date" | "eventType" | "none";

export type HealthReportFocus =
  | "overview"
  | "medications"
  | "medications-today"
  | "medication-list";

export interface HealthReportEventItem {
  id: string;
  title: string;
  type?: string;
  typeLabel: string;
  memberLabel: string;
  ongoing: boolean;
  startedAt: string | null;
  startedAtLabel?: string;
  localDate?: string | null;
  notes?: string | null;
}

export interface HealthTodayDoseRow {
  medicationId: string;
  medicationName: string;
  dosage: string | null;
  memberId: string;
  memberLabel: string;
  scheduleKind: string;
  status: string;
  statusLabel: string;
  scheduledAt: string | null;
  scheduledAtLabel: string;
  loggedAt: string | null;
  loggedAtLabel: string | null;
  notes: string | null;
}

export interface HealthMedicationListItem {
  id: string;
  name: string;
  dosage?: string | null;
  instructions?: string | null;
  scheduleKind: string;
  scheduleSummary?: string;
  memberId: string;
  memberLabel: string;
  enabled: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

export interface HealthReportExport {
  from: string;
  to: string;
  timezone: string;
  memberId?: string | null;
  eventType?: string | null;
  groupBy?: HealthReportGroupBy;
  medicationId?: string | null;
  scheduleKind?: string | null;
  summary: {
    totalEvents: number;
    ongoingCount: number;
    activeMedications: number;
    scheduledMedications: number;
    intervalMedications?: number;
    prnMedications: number;
    dosesLogged: number;
  };
  eventsByType: { type: string; label: string; count: number }[];
  eventsByMember: { memberId: string; label: string; count: number }[];
  medicationAdherence: {
    medicationId: string;
    name: string;
    scheduleKind: string;
    memberId?: string;
    memberLabel?: string;
    taken: number;
    skipped: number;
    missed: number;
    pending?: number;
    expected?: number;
    prn: number;
    scheduledTotal: number;
    adherencePct: number | null;
  }[];
  prnFrequency?: { date: string; memberId: string; memberLabel: string; count: number }[];
  medications?: HealthMedicationListItem[];
  eventHistory: HealthReportEventItem[];
  eventGroups?: {
    key: string;
    label: string;
    events: HealthReportEventItem[];
  }[];
  medicationLogHistory: {
    id: string;
    medicationName: string;
    memberLabel: string;
    status: string;
    loggedAt: string;
    loggedAtLabel?: string;
    scheduledAt: string | null;
    scheduledAtLabel?: string | null;
    prn: boolean;
    notes?: string | null;
  }[];
  todayDoses?: HealthTodayDoseRow[];
  todayDoseDate?: string;
  /** @deprecated Prefer eventHistory */
  recentEvents?: HealthReportEventItem[];
}

export const HEALTH_REPORT_EVENT_TYPES: { value: string; label: string }[] = [
  { value: "sickness", label: "Sickness" },
  { value: "injury", label: "Injury" },
  { value: "appointment", label: "Appointment" },
  { value: "symptom", label: "Symptom" },
  { value: "medication", label: "Medication" },
  { value: "other", label: "Other" },
];

export const HEALTH_REPORT_SCHEDULE_KINDS: { value: string; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "interval", label: "Interval" },
  { value: "prn", label: "PRN" },
];

export const HEALTH_REPORT_FOCUS_OPTIONS: { id: HealthReportFocus; label: string }[] = [
  { id: "overview", label: "Events" },
  { id: "medications-today", label: "Today's doses" },
  { id: "medications", label: "Dose history" },
  { id: "medication-list", label: "Medication list" },
];
