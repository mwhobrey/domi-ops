export type HealthReportGroupBy = "date" | "eventType" | "none";

export interface HealthReportEventItem {
  id: string;
  title: string;
  type?: string;
  typeLabel: string;
  memberLabel: string;
  ongoing: boolean;
  startedAt: string | null;
  localDate?: string | null;
  notes?: string | null;
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
  medications?: {
    id: string;
    name: string;
    scheduleKind: string;
    memberId: string;
    memberLabel: string;
    enabled: boolean;
  }[];
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
    scheduledAt: string | null;
    prn: boolean;
    notes?: string | null;
  }[];
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
