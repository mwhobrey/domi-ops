export const HOUSEHOLD_ADMIN_ROLES = ["owner", "admin"] as const;
export const STAFF_ENROLLMENT_ROLES = ["teacher", "parent", "aide"] as const;

export type SchoolViewMode = "admin" | "staff" | "student" | "observer";

export interface MemberEnrollmentRow {
  classId: string;
  role: string;
  activeFrom: string | Date | null;
  activeTo: string | Date | null;
}

export interface SchoolClassAccess {
  canManage: boolean;
  canEnroll: boolean;
  canEditAssignments: boolean;
  canEditCategories: boolean;
  canEditClassMeta: boolean;
  canGrade: boolean;
  canSubmit: boolean;
  canViewRoster: boolean;
  canViewFullGradebook: boolean;
  viewMode: SchoolViewMode;
  enrollmentRole: string | null;
}

export interface SchoolContext {
  memberId: string;
  householdRole: string;
  viewMode: SchoolViewMode;
  viewLabel: string;
  canCreateClass: boolean;
}

export function isHouseholdAdmin(householdRole: string): boolean {
  return (HOUSEHOLD_ADMIN_ROLES as readonly string[]).includes(householdRole);
}

export function isStaffEnrollmentRole(role: string): boolean {
  return (STAFF_ENROLLMENT_ROLES as readonly string[]).includes(role);
}

export function isEnrollmentActiveNow(
  activeFrom: string | Date | null,
  activeTo: string | Date | null,
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (activeFrom) {
    const from = new Date(
      typeof activeFrom === "string" && !activeFrom.includes("T")
        ? `${activeFrom}T12:00:00`
        : activeFrom,
    );
    if (from > today) return false;
  }
  if (activeTo) {
    const to = new Date(
      typeof activeTo === "string" && !activeTo.includes("T")
        ? `${activeTo}T12:00:00`
        : activeTo,
    );
    if (to < today) return false;
  }
  return true;
}

export function resolveClassAccess(params: {
  memberId: string;
  householdRole: string;
  teacherMemberId: string;
  enrollment: {
    role: string;
    activeFrom: string | Date | null;
    activeTo: string | Date | null;
  } | null;
}): SchoolClassAccess {
  const { memberId, householdRole, teacherMemberId, enrollment } = params;
  const isAdmin = isHouseholdAdmin(householdRole);
  const isClassTeacher = teacherMemberId === memberId;
  const active = enrollment
    ? isEnrollmentActiveNow(enrollment.activeFrom, enrollment.activeTo)
    : false;
  const enrollRole = active && enrollment ? enrollment.role : null;
  const staffEnroll = enrollRole != null && isStaffEnrollmentRole(enrollRole);
  const studentEnroll = enrollRole === "student";
  const observerEnroll = enrollRole === "observer";

  const canManage = isAdmin || isClassTeacher || staffEnroll;

  let viewMode: SchoolViewMode;
  if (isAdmin) viewMode = "admin";
  else if (canManage) viewMode = "staff";
  else if (studentEnroll) viewMode = "student";
  else if (observerEnroll) viewMode = "observer";
  else viewMode = "observer";

  return {
    canManage,
    canEnroll: canManage,
    canEditAssignments: canManage,
    canEditCategories: canManage,
    canEditClassMeta: canManage,
    canGrade: canManage,
    canSubmit: studentEnroll,
    canViewRoster: canManage,
    canViewFullGradebook: canManage || observerEnroll,
    viewMode,
    enrollmentRole: enrollRole,
  };
}

export function resolveSchoolContext(params: {
  memberId: string;
  householdRole: string;
  enrollments: MemberEnrollmentRow[];
  taughtClassIds: string[];
}): SchoolContext {
  const { memberId, householdRole, enrollments, taughtClassIds } = params;

  if (isHouseholdAdmin(householdRole)) {
    return {
      memberId,
      householdRole,
      viewMode: "admin",
      viewLabel: "Managing household classes",
      canCreateClass: true,
    };
  }

  const activeEnrollments = enrollments.filter((e) =>
    isEnrollmentActiveNow(e.activeFrom, e.activeTo),
  );
  const hasStaff =
    activeEnrollments.some((e) => isStaffEnrollmentRole(e.role)) || taughtClassIds.length > 0;
  const hasStudent = activeEnrollments.some((e) => e.role === "student");
  const hasObserver = activeEnrollments.some((e) => e.role === "observer");

  if (hasStaff) {
    return {
      memberId,
      householdRole,
      viewMode: "staff",
      viewLabel: "Teaching & managing classes",
      canCreateClass: true,
    };
  }
  if (hasStudent) {
    return {
      memberId,
      householdRole,
      viewMode: "student",
      viewLabel: "Viewing as student",
      canCreateClass: false,
    };
  }
  if (hasObserver) {
    return {
      memberId,
      householdRole,
      viewMode: "observer",
      viewLabel: "Observer — read only",
      canCreateClass: false,
    };
  }

  return {
    memberId,
    householdRole,
    viewMode: "observer",
    viewLabel: "No class enrollments",
    canCreateClass: false,
  };
}

export function visibleClassIdsForMember(params: {
  memberId: string;
  householdRole: string;
  classes: { id: string; teacherMemberId: string; archived: boolean }[];
  enrollments: MemberEnrollmentRow[];
  includeArchived?: boolean;
}): string[] {
  const { memberId, householdRole, classes, enrollments, includeArchived } = params;

  const enrolledClassIds = new Set(
    enrollments
      .filter((e) => isEnrollmentActiveNow(e.activeFrom, e.activeTo))
      .map((e) => e.classId),
  );

  return classes
    .filter((c) => {
      if (!includeArchived && c.archived) return false;
      if (isHouseholdAdmin(householdRole)) return true;
      return enrolledClassIds.has(c.id) || c.teacherMemberId === memberId;
    })
    .map((c) => c.id);
}

export function schoolViewLabel(viewMode: SchoolViewMode): string {
  switch (viewMode) {
    case "admin":
      return "Managing household classes";
    case "staff":
      return "Teaching & managing classes";
    case "student":
      return "Viewing as student";
    case "observer":
      return "Observer — read only";
  }
}
