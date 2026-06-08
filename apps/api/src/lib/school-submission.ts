export function isSubmissionLate(
  dueAt: Date | null | undefined,
  submittedAt: Date,
): boolean {
  if (!dueAt) return false;
  return submittedAt.getTime() > dueAt.getTime();
}

export function canSubmitPastDue(params: {
  dueAt: Date | null;
  allowLate: boolean;
  now: Date;
  existingStatus: string | null;
}): { allowed: true } | { allowed: false; error: "late_not_allowed" } {
  const { dueAt, allowLate, now, existingStatus } = params;
  if (allowLate) return { allowed: true };
  if (!dueAt || now.getTime() <= dueAt.getTime()) return { allowed: true };

  const alreadyStarted =
    existingStatus === "submitted" ||
    existingStatus === "graded" ||
    existingStatus === "returned";
  if (alreadyStarted) return { allowed: true };

  return { allowed: false, error: "late_not_allowed" };
}
