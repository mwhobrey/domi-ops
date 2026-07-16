"use client";

import { GraduationCap, Eye } from "lucide-react";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolContext } from "../lib/school-access";
import { schoolViewBadgeTone } from "../lib/school-access";
import { SchoolClassCard } from "./SchoolClassCard";
import { SchoolReportsLink } from "./SchoolReports";
import { ListPage } from "./lists/ListPage";
import { Badge, Button, EmptyState, Input, SectionHeader, StatTile } from "./ui";

interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
  myEnrollmentRole?: string | null;
}

interface SchoolGlance {
  classCount: number;
  dueSoon: number;
  overdue: number;
}

export function SchoolClassList({
  initialClasses,
  glance,
  context,
}: {
  initialClasses: SchoolClass[];
  glance: SchoolGlance;
  context: SchoolContext | null;
}) {
  const [classes, setClasses] = useState(initialClasses);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isStudent = context?.viewMode === "student";
  const isObserver = context?.viewMode === "observer";
  const canCreate = context?.canCreateClass ?? true;
  const statLabels = isStudent
    ? { due: "Due this week", overdue: "Overdue" }
    : { due: "Due this week", overdue: "Overdue" };

  return (
    <div className="space-y-6">
      {context && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 bg-[var(--color-surface)]/40 px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <Eye className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
          <span className="text-sm text-[var(--color-text-muted)]">School view</span>
          <Badge tone={schoolViewBadgeTone(context.viewMode)}>{context.viewLabel}</Badge>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <StatTile
            label={statLabels.due}
            value={glance.dueSoon}
            href="/school/assignments?filter=due"
            tone={glance.dueSoon > 0 ? "default" : "success"}
          />
          <StatTile
            label={statLabels.overdue}
            value={glance.overdue}
            href="/school/assignments?filter=overdue"
            tone={glance.overdue > 0 ? "warning" : "success"}
          />
        </div>
        {context && <SchoolReportsLink />}
      </div>

      <ListPage
        error={error}
        onDismissError={() => setError(null)}
        addForm={
          canCreate ? (
            <form
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                setLoading(true);
                setError(null);
                try {
                  const data = await apiClient.post<{ class: SchoolClass }>("/api/school/classes", {
                    name: name.trim(),
                    subject: subject.trim() || undefined,
                    term: term.trim() || undefined,
                  });
                  setClasses((prev) => [...prev, data.class]);
                  setName("");
                  setSubject("");
                  setTerm("");
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Failed to create class");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Input
                className="sm:col-span-2"
                placeholder="Class name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Class name"
                required
              />
              <Input
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                aria-label="Subject"
              />
              <Input
                placeholder="Term (e.g. Fall 2026)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                aria-label="Term"
              />
              <Button
                type="submit"
                loading={loading}
                className="sm:col-span-2 lg:col-span-4 lg:justify-self-start"
              >
                Create class
              </Button>
            </form>
          ) : undefined
        }
      >
        {classes.length === 0 ? (
          <EmptyState
            title={isStudent ? "No classes enrolled" : "No classes yet"}
            description={
              isStudent
                ? "Ask a parent or teacher to enroll you in a class."
                : isObserver
                  ? "You have observer access but no active class enrollments."
                  : "Add your first homeschool class above — name, subject, and term help everyone stay oriented."
            }
            icon={<GraduationCap className="h-10 w-10" aria-hidden />}
          />
        ) : (
          <section aria-labelledby="school-classes-heading">
            <SectionHeader
              title={isStudent ? "My classes" : "Your classes"}
              className="mb-4"
            />
            <h2 id="school-classes-heading" className="sr-only">
              {isStudent ? "My classes" : "Your classes"}
            </h2>
            <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {classes.map((c) => (
                <li key={c.id}>
                  <SchoolClassCard
                    id={c.id}
                    name={c.name}
                    subject={c.subject}
                    term={c.term}
                    enrollmentRole={c.myEnrollmentRole}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </ListPage>
    </div>
  );
}
