// Transcript math: letter grades, GPA, and credits. Pure. There is no universal grade scale
// (plain 90/80/70/60, plus/minus, and 7-point scales are all common), so the scale is data: a
// household picks a preset or defines their own, and every function here takes it as input.

export interface GradeBand {
  /** Lowest percent that earns this letter. */
  min: number;
  letter: string;
  /** Grade points for GPA, usually 0-4. */
  points: number;
}

export interface GradeScale {
  /** Lowest percent that still earns credit for the course. */
  passingPercent: number;
  /** Any order; sorted high to low when used. Must include a band at min 0. */
  bands: GradeBand[];
}

const band = (min: number, letter: string, points: number): GradeBand => ({ min, letter, points });

export const GRADE_SCALE_PRESETS: { id: string; label: string; scale: GradeScale }[] = [
  {
    id: "standard",
    label: "A/B/C/D/F (90, 80, 70, 60)",
    scale: {
      passingPercent: 60,
      bands: [band(90, "A", 4), band(80, "B", 3), band(70, "C", 2), band(60, "D", 1), band(0, "F", 0)],
    },
  },
  {
    id: "plus-minus",
    label: "Plus/minus (A 93, A- 90, B+ 87 …)",
    scale: {
      passingPercent: 60,
      bands: [
        band(93, "A", 4),
        band(90, "A-", 3.7),
        band(87, "B+", 3.3),
        band(83, "B", 3),
        band(80, "B-", 2.7),
        band(77, "C+", 2.3),
        band(73, "C", 2),
        band(70, "C-", 1.7),
        band(67, "D+", 1.3),
        band(63, "D", 1),
        band(60, "D-", 0.7),
        band(0, "F", 0),
      ],
    },
  },
  {
    id: "seven-point",
    label: "7-point (A 93, B 85, C 77, D 70)",
    scale: {
      passingPercent: 70,
      bands: [band(93, "A", 4), band(85, "B", 3), band(77, "C", 2), band(70, "D", 1), band(0, "F", 0)],
    },
  },
];

export const DEFAULT_GRADE_SCALE: GradeScale = GRADE_SCALE_PRESETS[0]!.scale;

/** Returns a cleaned scale, or an error message. Used for anything a user typed. */
export function validateGradeScale(input: unknown): { scale: GradeScale } | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "Scale must be an object" };
  const { passingPercent, bands } = input as { passingPercent?: unknown; bands?: unknown };
  if (typeof passingPercent !== "number" || !(passingPercent >= 0 && passingPercent <= 100)) {
    return { error: "Passing percent must be between 0 and 100" };
  }
  if (!Array.isArray(bands) || bands.length < 2 || bands.length > 20) {
    return { error: "A scale needs between 2 and 20 grades" };
  }
  const cleaned: GradeBand[] = [];
  for (const b of bands) {
    const { min, letter, points } = (b ?? {}) as Record<string, unknown>;
    if (typeof min !== "number" || !(min >= 0 && min <= 100)) return { error: "Each grade needs a percent from 0 to 100" };
    if (typeof letter !== "string" || letter.trim().length < 1 || letter.trim().length > 12) {
      return { error: "Each grade needs a label up to 12 characters" };
    }
    if (typeof points !== "number" || !(points >= 0 && points <= 10)) return { error: "Grade points must be between 0 and 10" };
    cleaned.push({ min, letter: letter.trim(), points });
  }
  if (new Set(cleaned.map((b) => b.min)).size !== cleaned.length) return { error: "Two grades share the same percent" };
  if (!cleaned.some((b) => b.min === 0)) return { error: "The lowest grade must start at 0%" };
  cleaned.sort((a, b) => b.min - a.min);
  return { scale: { passingPercent, bands: cleaned } };
}

/** The scale stored on a household, or the default when unset or unreadable. */
export function scaleOrDefault(stored: unknown): GradeScale {
  if (stored == null) return DEFAULT_GRADE_SCALE;
  const parsed = validateGradeScale(stored);
  return "scale" in parsed ? parsed.scale : DEFAULT_GRADE_SCALE;
}

export function gradeFor(percent: number, scale: GradeScale): GradeBand {
  const sorted = [...scale.bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => percent >= b.min) ?? sorted[sorted.length - 1]!;
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
  letter: string | null;
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

export function gradeCourse(input: TranscriptCourseInput, scale: GradeScale = DEFAULT_GRADE_SCALE): TranscriptCourse {
  if (input.finalPercent == null) {
    return { ...input, letter: null, gradePoints: null, creditsAttempted: 0, creditsEarned: 0, inProgress: true };
  }
  const grade = gradeFor(input.finalPercent, scale);
  return {
    ...input,
    letter: grade.letter,
    gradePoints: grade.points,
    creditsAttempted: input.credits,
    creditsEarned: input.finalPercent >= scale.passingPercent ? input.credits : 0,
    inProgress: false,
  };
}

/** Terms sort by label; courses with no term go last as "Unassigned". */
export function buildTranscript(courses: TranscriptCourseInput[], scale: GradeScale = DEFAULT_GRADE_SCALE): Transcript {
  const graded = courses.map((c) => gradeCourse(c, scale));
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
