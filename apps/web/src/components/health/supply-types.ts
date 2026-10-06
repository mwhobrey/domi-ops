/**
 * Shapes the pharmacy and supply endpoints answer with (WHO-418 to WHO-420). Kept apart from
 * health-types.ts so the pharmacy and supply screens share them without growing that file.
 */

export interface PharmacyMedication {
  id: string;
  memberId: string;
  name: string;
  enabled: boolean;
}

export interface Pharmacy {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  /** The dialable form of `phone` for a tel: link; null when there is no usable number. */
  phoneTel: string | null;
  website: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Current medications the caller is allowed to see; medications they cannot see are not counted. */
  medicationCount: number;
  medications: PharmacyMedication[];
  canEdit: boolean;
}

/** The pharmacy a medication uses, as medication responses carry it. */
export interface PharmacySummary {
  id: string;
  name: string;
  archived: boolean;
}

export type RefillState = "inactive" | "no_estimate" | "not_needed" | "ok" | "needs_refill" | "requested";

/** A medication's supply estimate as medication responses carry it. */
export interface SupplySummary {
  runsOutOn: string | null;
  estimatedOn: string | null;
  daysRemaining: number | null;
  outsideDays: number | null;
  organizerDaysCounted: number | null;
  revision: number;
  /** Send this back when changing the supply, so a stale edit is refused instead of overwriting. */
  version: number;
  leadDays: number;
  leadDaysOverride: number | null;
  state: RefillState;
  deadline: string | null;
  overdue: boolean;
  requestedAt: string | null;
  receivedAt: string | null;
  needsConfirmation: boolean;
}
