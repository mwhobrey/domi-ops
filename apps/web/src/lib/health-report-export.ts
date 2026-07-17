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
  summary: {
    totalEvents: number;
    ongoingCount: number;
    activeMedications: number;
    scheduledMedications: number;
    prnMedications: number;
    dosesLogged: number;
  };
  eventsByType: { type: string; label: string; count: number }[];
  eventsByMember: { memberId: string; label: string; count: number }[];
  medicationAdherence: {
    medicationId: string;
    name: string;
    scheduleKind: string;
    taken: number;
    skipped: number;
    missed: number;
    prn: number;
    scheduledTotal: number;
    adherencePct: number | null;
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
