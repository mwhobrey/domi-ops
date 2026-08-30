"use client";

import { useState } from "react";
import type { GradebookData } from "../lib/school-gradebook";
import type { SchoolClassAccess } from "../lib/school-access";
import type { Category, ClassMeta, Enrollment, Member, Assignment } from "../lib/school-class-types";
import { SchoolCategoryList } from "./SchoolCategoryList";
import { SchoolClassAssignmentsCard } from "./SchoolClassAssignmentsCard";
import { SchoolClassDetailsCard } from "./SchoolClassDetailsCard";
import { SchoolClassGradebookSection } from "./SchoolClassGradebook";
import { SchoolClassRosterCard } from "./SchoolClassRosterCard";
import { Card, CardBody, CardHeader, SectionHeader } from "./ui";

/**
 * A class's detail page: class meta, gradebook progress, assignments, grade categories, and
 * roster. Each card below (details / assignments / roster) owns its own state and API calls —
 * split out of a single 1768-line component (2026-08-30) — this component just wires the SSR
 * data through and renders them, plus the two sections still small enough to stay inline
 * (Progress and Grade categories are both thin wrappers around an existing component).
 */
export function SchoolClassDetail({
  classId,
  initialClass,
  initialAssignments,
  initialEnrollments,
  initialGradebook,
  initialCategories,
  members,
  access,
  currentMemberId,
  driveEnabled = false,
}: {
  classId: string;
  initialClass: ClassMeta;
  initialAssignments: Assignment[];
  initialEnrollments: Enrollment[];
  initialGradebook: GradebookData;
  initialCategories: Category[];
  members: Member[];
  access: SchoolClassAccess;
  currentMemberId: string;
  driveEnabled?: boolean;
}) {
  const canEditAssignments = access.canEditAssignments;
  const canViewRoster = access.canViewRoster;
  const canEditCategories = access.canEditCategories;
  const canEditClassMeta = access.canEditClassMeta;
  const canViewFullGradebook = access.canViewFullGradebook;

  const studentGradebook: GradebookData =
    access.viewMode === "student"
      ? {
          ...initialGradebook,
          students: initialGradebook.students.filter((s) => s.memberId === currentMemberId),
          summary: (() => {
            const me = initialGradebook.students.find((s) => s.memberId === currentMemberId);
            return {
              ...initialGradebook.summary,
              studentCount: me ? 1 : 0,
              missingTotal: me?.missingCount ?? 0,
              overdueTotal: me?.overdueCount ?? 0,
              gradedTotal: me?.gradedCount ?? 0,
              submittedTotal: me?.submittedCount ?? 0,
              classAveragePercent: me?.averagePercent ?? null,
            };
          })(),
        }
      : initialGradebook;

  const [categories, setCategories] = useState(initialCategories);

  return (
    <div className="space-y-8">
      <SchoolClassDetailsCard
        classId={classId}
        initialClass={initialClass}
        members={members}
        canEditClassMeta={canEditClassMeta}
      />

      <Card>
        <CardHeader>
          <SectionHeader title="Progress" />
        </CardHeader>
        <CardBody>
          <SchoolClassGradebookSection
            classId={classId}
            gradebook={studentGradebook}
            members={members}
            showFullGradebookLink={canViewFullGradebook}
          />
        </CardBody>
      </Card>

      <SchoolClassAssignmentsCard
        classId={classId}
        initialAssignments={initialAssignments}
        categories={categories}
        driveEnabled={driveEnabled}
        canEditAssignments={canEditAssignments}
      />

      {(canEditCategories || categories.length > 0) && (
        <Card>
          <CardHeader>
            <SectionHeader title="Grade categories" />
          </CardHeader>
          <CardBody>
            <SchoolCategoryList
              classId={classId}
              categories={categories}
              onCategoriesChange={setCategories}
              readOnly={!canEditCategories}
            />
          </CardBody>
        </Card>
      )}

      {canViewRoster && (
        <SchoolClassRosterCard
          classId={classId}
          initialEnrollments={initialEnrollments}
          members={members}
        />
      )}
    </div>
  );
}
