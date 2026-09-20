/** Schedule kinds that log doses with `scheduled_at = null` (PRN + OTC as-needed). */
export type AsNeededMedScheduleKind = "prn" | "otc";

export type MedScheduleKind = "scheduled" | AsNeededMedScheduleKind | "interval";

export function isAsNeededMedScheduleKind(
  kind: string | null | undefined,
): kind is AsNeededMedScheduleKind {
  return kind === "prn" || kind === "otc";
}
