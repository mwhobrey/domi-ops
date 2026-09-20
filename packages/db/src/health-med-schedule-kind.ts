/** Schedule kinds that log doses with `scheduled_at = null` (PRN + OTC as-needed). */
export type AsNeededMedScheduleKind = "prn" | "otc";

export type MedScheduleKind = "scheduled" | AsNeededMedScheduleKind | "interval";

export function isAsNeededMedScheduleKind(
  kind: string | null | undefined,
): kind is AsNeededMedScheduleKind {
  return kind === "prn" || kind === "otc";
}

export type GroupMedScheduleKind = "scheduled" | "interval";

/** Groups only accept fixed schedules — not PRN/OTC. */
export function narrowGroupScheduleMeta(meta: {
  scheduleKind: MedScheduleKind;
  scheduleJson: string;
}): { scheduleKind: GroupMedScheduleKind; scheduleJson: string } | null {
  if (isAsNeededMedScheduleKind(meta.scheduleKind)) return null;
  if (meta.scheduleKind === "scheduled" || meta.scheduleKind === "interval") {
    return { scheduleKind: meta.scheduleKind, scheduleJson: meta.scheduleJson };
  }
  return null;
}
