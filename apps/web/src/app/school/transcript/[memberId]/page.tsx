export const dynamic = "force-dynamic";

import Link from "next/link";
import { PrintButton } from "../../../../components/PrintButton";
import { Alert } from "../../../../components/ui";
import { apiFetch } from "../../../../lib/api";
import { loadErrorMessage } from "../../../../lib/load-error";
import { formatHours, type GradeScale, type TranscriptData } from "../../../../lib/school-records";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "A 93+, A- 90+, …, F below 60" from the household's own scale. */
function describeScale(scale: GradeScale): string {
  const bands = [...scale.bands].sort((a, b) => b.min - a.min);
  const parts = bands.map((b, i) =>
    i === bands.length - 1 && b.min === 0
      ? `${b.letter} below ${bands[i - 1]?.min ?? 0}`
      : `${b.letter} ${b.min}+`,
  );
  return parts.join(", ");
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A printable transcript. Deliberately outside AppShell: no nav chrome to hide, and "Print or
 * save as PDF" produces a clean page. The grade scale is fixed (see school-transcript-math.ts).
 */
export default async function SchoolTranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { memberId } = await params;
  const { from, to } = await searchParams;
  const query = new URLSearchParams();
  if (from && ISO_DATE.test(from)) query.set("from", from);
  if (to && ISO_DATE.test(to)) query.set("to", to);
  const qs = query.size > 0 ? `?${query}` : "";

  let data: TranscriptData | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetch<TranscriptData>(`/api/school/transcript/${encodeURIComponent(memberId)}${qs}`);
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load the transcript");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/school/records" className="text-sm text-[var(--color-accent)] hover:underline">
          ← Back to records
        </Link>
        {data && <PrintButton />}
      </div>

      {loadError || !data ? (
        <Alert variant="error">{loadError ?? "Transcript not available"}</Alert>
      ) : (
        <article className="space-y-8 text-[var(--color-text)]">
          <header className="border-b border-[var(--color-border)] pb-4">
            <p className="text-label text-[var(--color-text-muted)]">{data.householdName}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Academic transcript
            </h1>
            <p className="mt-2 text-lg">{data.student.label}</p>
            {(data.range.from || data.range.to) && (
              <p className="text-sm text-[var(--color-text-muted)]">
                Days of instruction and hours:{" "}
                {data.range.from ? fmtDate(data.range.from) : "start"} to{" "}
                {data.range.to ? fmtDate(data.range.to) : "present"}
              </p>
            )}
          </header>

          {data.transcript.terms.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">
              No classes yet. Enroll this student in a class to build a transcript.
            </p>
          ) : (
            data.transcript.terms.map((term) => (
              <section key={term.term ?? "unassigned"} className="break-inside-avoid">
                <h2 className="text-lg font-semibold">{term.term ?? "No term set"}</h2>
                <table className="mt-2 w-full text-left text-sm">
                  <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Course</th>
                      <th className="px-2 py-2 text-right font-medium">Credits</th>
                      <th className="px-2 py-2 text-right font-medium">Percent</th>
                      <th className="py-2 pl-2 text-right font-medium">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {term.courses.map((c) => (
                      <tr key={c.classId}>
                        <td className="py-2 pr-4">
                          {c.name}
                          {c.subject && <span className="text-[var(--color-text-muted)]"> · {c.subject}</span>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{c.credits}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {c.finalPercent == null ? "—" : `${c.finalPercent}%`}
                        </td>
                        <td className="py-2 pl-2 text-right font-medium">
                          {c.inProgress ? <span className="font-normal text-[var(--color-text-muted)]">In progress</span> : c.letter}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-right text-sm text-[var(--color-text-muted)]">
                  Credits earned {term.creditsEarned} · GPA {term.gpa ?? "—"}
                </p>
              </section>
            ))
          )}

          <section className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-4">
            <Stat label="Cumulative GPA" value={data.transcript.gpa ?? "—"} />
            <Stat label="Credits earned" value={data.transcript.creditsEarned} />
            <Stat label="Days of instruction" value={data.daysOfInstruction} />
            <Stat label="Hours logged" value={formatHours(data.hours.totalMinutes)} />
          </section>

          <footer className="space-y-1 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]">
            <p>
              Grade scale: {describeScale(data.gradeScale)}. Credit is earned at {data.gradeScale.passingPercent}%
              or above. GPA is unweighted and weighted by credits, using the grade points for each grade. A
              course with no graded work is shown as in progress and excluded from GPA and credits.
            </p>
            <p>
              Prepared by the student&apos;s parent or instructor from Domi Ops records on{" "}
              {fmtDate(data.generatedAt.slice(0, 10))}. Not an official document of any school district.
            </p>
          </footer>
        </article>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-label text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
