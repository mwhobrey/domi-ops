export type SchoolViewMode = "admin" | "staff" | "student" | "observer";

export interface SchoolContext {
  memberId: string;
  householdRole: string;
  viewMode: SchoolViewMode;
  viewLabel: string;
  canCreateClass: boolean;
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

export function schoolViewBadgeTone(
  viewMode: SchoolViewMode,
): "default" | "accent" | "success" | "warning" {
  switch (viewMode) {
    case "admin":
      return "success";
    case "staff":
      return "accent";
    case "student":
      return "default";
    case "observer":
      return "warning";
  }
}

export function isStudentView(access: SchoolClassAccess | undefined): boolean {
  return access?.viewMode === "student";
}

export function isReadOnlySchoolView(access: SchoolClassAccess | undefined): boolean {
  return access?.viewMode === "observer";
}
