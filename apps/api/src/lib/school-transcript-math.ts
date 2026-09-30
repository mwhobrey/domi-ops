// Transcript math: letter grades, GPA, and credits. Pure. The scale is the common US
// unweighted one (A 90+, B 80+, C 70+, D 60+, F below), without plus/minus.

export type LetterGrade = "A" | "B" | "C" | "D" | "F";

const GRADE_POINTS: Record<LetterGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

/** Lowest percent that still earns credit. */
export const PASSING_PERCENT = 60;

export function letterGrade(percent: number): LetterGrade {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= PASSING_PERCENT) return "D";
  return "F";
}

export interface TranscriptCourseInput {
  classId: string;
  name: string;
  subject: string | null;
  term: string | null;
  credits: number;
  /** Weighted final if the class has weighted categories, else points average. Null = nothing graded yet. */
  finalPercent: number | null;
}

export interface TranscriptCourse extends TranscriptCourseInput {
  letter: LetterGrade | null;
  gradePoints: number | null;
  creditsAttempted: number;
  creditsEarned: number;
  inProgress: boolean;
}

export interface TranscriptTerm {
  term: string | null;
  courses: TranscriptCourse[];
  creditsAttempted: number;
  creditsEarned: number;
  gpa: number | null;
}

export interface Transcript {
  terms: TranscriptTerm[];
  creditsAttempted: number;
  creditsEarned: number;
  gpa: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function gpaOf(courses: TranscriptCourse[]): number | null {
  let points = 0;
  let credits = 0;
  for (const c of courses) {
    if (c.gradePoints == null) continue;
    points += c.gradePoints * c.creditsAttempted;
    credits += c.creditsAttempted;
  }
  return credits > 0 ? round2(points / credits) : null;
}

export function gradeCourse(input: TranscriptCourseInput): TranscriptCourse {
  if (input.finalPercent == null) {
    return {
      ...input,
      letter: null,
      gradePoints: null,
      creditsAttempted: 0,
      creditsEarned: 0,
      inProgress: true,
    };
  }
  const letter = letterGrade(input.finalPercent);
  return {
    ...input,
    letter,
    gradePoints: GRADE_POINTS[letter],
    creditsAttempted: input.credits,
    creditsEarned: letter === "F" ? 0 : input.credits,
    inProgress: false,
  };
}

/** Terms sort by label; courses with no term go last as "Unassigned". */
export function buildTranscript(courses: TranscriptCourseInput[]): Transcript {
  const graded = courses.map(gradeCourse);
  const byTerm = new Map<string | null, TranscriptCourse[]>();
  for (const c of graded) {
    const key = c.term?.trim() ? c.term.trim() : null;
    const list = byTerm.get(key) ?? [];
    list.push(c);
    byTerm.set(key, list);
  }

  const terms: TranscriptTerm[] = [...byTerm.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([term, list]) => ({
      term,
      courses: list.sort((a, b) => a.name.localeCompare(b.name)),
      creditsAttempted: round2(list.reduce((s, c) => s + c.creditsAttempted, 0)),
      creditsEarned: round2(list.reduce((s, c) => s + c.creditsEarned, 0)),
      gpa: gpaOf(list),
    }));

  return {
    terms,
    creditsAttempted: round2(terms.reduce((s, t) => s + t.creditsAttempted, 0)),
    creditsEarned: round2(terms.reduce((s, t) => s + t.creditsEarned, 0)),
    gpa: gpaOf(graded),
  };
}
