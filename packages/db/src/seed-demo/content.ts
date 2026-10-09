import { encryptSensitive } from "@domi-ops/crypto";
import type { Database } from "../client.js";
import {
  calendars,
  calendarEvents,
  choreCompletions,
  choreMemberKarma,
  chores,
  driveFolders,
  driveObjects,
  expenseBudgets,
  expenses,
  healthEvents,
  healthMedicationLogs,
  healthMedications,
  healthVitalsReadings,
  notes,
  notices,
  noticeReads,
  schoolAssignmentCategories,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolHoursLog,
  schoolInstructionDays,
  schoolSubmissions,
  shoppingItems,
} from "../schema/index.js";
import { households } from "../schema/household.js";
import {
  addDaysYmd,
  chicagoInstant,
  chicagoYmd,
  dueAtEndOfDayYmd,
  parseYmd,
  weekDayYmd,
} from "./dates.js";
import { DEMO_HOUSEHOLD_NAME, DEMO_MODULES, DEMO_SLUG } from "./constants.js";
import type { DemoSeedContext } from "./members.js";

function shoppingAisle(aisle: string): string {
  return JSON.stringify([`aisle:${aisle}`]);
}

function encHealth(value: string, encryptionKey: string | undefined): string {
  if (!encryptionKey) return value;
  return encryptSensitive(value, encryptionKey);
}

export async function insertDemoHousehold(
  db: Database,
): Promise<string> {
  const [household] = await db
    .insert(households)
    .values({
      name: DEMO_HOUSEHOLD_NAME,
      slug: DEMO_SLUG,
      tier: "self_host",
      timezone: "America/Chicago",
      schoolDaysTarget: 180,
      modulesEnabled: JSON.stringify(DEMO_MODULES),
      storageQuotaBytes: null,
      storageUsedBytes: 0,
    })
    .returning({ id: households.id });
  return household.id;
}

export async function seedDemoContent(
  db: Database,
  ctx: DemoSeedContext,
  encryptionKey: string | undefined,
): Promise<void> {
  const { householdId, members, ownerUserId } = ctx;
  const maria = members.maria;
  const sofia = members.sofia;
  const lucas = members.lucas;

  const today = chicagoYmd(0);
  const yesterday = chicagoYmd(-1);
  const todayParts = parseYmd(today);
  const schoolYearStart = todayParts.m >= 7 ? todayParts.y : todayParts.y - 1;
  const schoolTerm = `${schoolYearStart}–${schoolYearStart + 1}`;

  // —— Calendar ——
  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      ownerUserId: maria.userId,
      name: "Family",
      color: "#3b82f6",
      visibility: "household",
      isHouseholdDefault: true,
    })
    .returning({ id: calendars.id });

  const calId = calendar.id;

  await db.insert(calendarEvents).values([
    {
      householdId,
      calendarId: calId,
      title: "Piano lesson",
      startDate: weekDayYmd(2),
      startTime: "16:00:00",
      endTime: "17:00:00",
      allDay: false,
      color: "#8b5cf6",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Soccer practice",
      startDate: weekDayYmd(3),
      startTime: "17:30:00",
      endTime: "18:30:00",
      allDay: false,
      color: "#22c55e",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Homeschool co-op",
      startDate: weekDayYmd(4),
      allDay: true,
      color: "#f59e0b",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Library day",
      startDate: weekDayYmd(4),
      allDay: true,
      color: "#06b6d4",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Grandma visit",
      startDate: weekDayYmd(4),
      allDay: true,
      color: "#ec4899",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Dentist — Sofia",
      startDate: weekDayYmd(5),
      startTime: "10:00:00",
      endTime: "10:45:00",
      allDay: false,
      color: "#8b5cf6",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Farmers market",
      startDate: weekDayYmd(0),
      startTime: "09:30:00",
      endTime: "11:00:00",
      allDay: false,
      color: "#22c55e",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Family dinner at Abuela's",
      startDate: weekDayYmd(1),
      startTime: "18:00:00",
      endTime: "20:00:00",
      allDay: false,
      color: "#ec4899",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Park day with the co-op kids",
      startDate: weekDayYmd(2),
      startTime: "13:00:00",
      endTime: "14:30:00",
      allDay: false,
      color: "#06b6d4",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Grocery pickup",
      startDate: weekDayYmd(3),
      startTime: "11:00:00",
      endTime: "11:30:00",
      allDay: false,
      color: "#f59e0b",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Life Science lab day",
      startDate: weekDayYmd(4),
      startTime: "10:30:00",
      endTime: "12:00:00",
      allDay: false,
      color: "#6366f1",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Library book club",
      startDate: weekDayYmd(5),
      startTime: "14:00:00",
      endTime: "15:00:00",
      allDay: false,
      color: "#06b6d4",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Soccer game — Lucas",
      startDate: weekDayYmd(6),
      startTime: "09:00:00",
      endTime: "11:00:00",
      allDay: false,
      color: "#22c55e",
      createdByUserId: maria.userId,
    },
    {
      householdId,
      calendarId: calId,
      title: "Field trip: Science museum",
      startDate: addDaysYmd(weekDayYmd(0), 8),
      allDay: true,
      color: "#6366f1",
      createdByUserId: maria.userId,
    },
  ]);

  // —— School ——
  const [mathClass] = await db
    .insert(schoolClasses)
    .values({
      householdId,
      name: "Math 6",
      subject: "Mathematics",
      term: schoolTerm,
      teacherMemberId: maria.memberId,
      scheduleJson: JSON.stringify({ days: ["Mon", "Wed", "Fri"], time: "09:00" }),
    })
    .returning({ id: schoolClasses.id });

  const [scienceClass] = await db
    .insert(schoolClasses)
    .values({
      householdId,
      name: "Life Science",
      subject: "Science",
      term: schoolTerm,
      teacherMemberId: maria.memberId,
      scheduleJson: JSON.stringify({ days: ["Tue", "Thu"], time: "10:30" }),
    })
    .returning({ id: schoolClasses.id });

  const [historyClass] = await db
    .insert(schoolClasses)
    .values({
      householdId,
      name: "World History",
      subject: "History",
      term: schoolTerm,
      teacherMemberId: maria.memberId,
      scheduleJson: JSON.stringify({ days: ["Mon", "Thu"], time: "13:00" }),
    })
    .returning({ id: schoolClasses.id });

  // Siblings learn together, so the gradebooks have more than one student column.
  await db.insert(schoolEnrollments).values([
    { classId: mathClass.id, memberId: sofia.memberId, role: "student" },
    { classId: mathClass.id, memberId: lucas.memberId, role: "student" },
    { classId: scienceClass.id, memberId: lucas.memberId, role: "student" },
    { classId: scienceClass.id, memberId: sofia.memberId, role: "student" },
    { classId: historyClass.id, memberId: sofia.memberId, role: "student" },
    { classId: historyClass.id, memberId: lucas.memberId, role: "student" },
  ]);

  /** Insert a weighted assignment category for a class and return its id. */
  async function addCategory(classId: string, name: string, weightPercent: number): Promise<string> {
    const [cat] = await db
      .insert(schoolAssignmentCategories)
      .values({ classId, name, weightPercent })
      .returning({ id: schoolAssignmentCategories.id });
    return cat.id;
  }
  const homeworkCatId = await addCategory(mathClass.id, "Homework", 30);
  const mathQuizCatId = await addCategory(mathClass.id, "Quizzes", 30);
  const mathTestCatId = await addCategory(mathClass.id, "Tests", 40);
  const labCatId = await addCategory(scienceClass.id, "Labs", 40);
  const sciQuizCatId = await addCategory(scienceClass.id, "Quizzes", 20);
  const sciProjectCatId = await addCategory(scienceClass.id, "Projects", 40);
  const readingCatId = await addCategory(historyClass.id, "Reading", 40);
  const histQuizCatId = await addCategory(historyClass.id, "Quizzes", 30);
  const histProjectCatId = await addCategory(historyClass.id, "Projects", 30);

  const wedDue = weekDayYmd(3);
  const friDue = weekDayYmd(5);

  const [fractionsAssignment] = await db
    .insert(schoolAssignments)
    .values({
      classId: mathClass.id,
      categoryId: homeworkCatId,
      title: "Fractions worksheet",
      instructionsHtml: "<p>Complete problems 1–20.</p>",
      dueAt: dueAtEndOfDayYmd(wedDue),
      pointsPossible: 100,
      visibility: "assigned",
      createdByUserId: maria.userId,
    })
    .returning({ id: schoolAssignments.id });

  const [labAssignment] = await db
    .insert(schoolAssignments)
    .values({
      classId: scienceClass.id,
      categoryId: labCatId,
      title: "Plant cell lab report",
      instructionsHtml: "<p>Include labeled diagram.</p>",
      dueAt: dueAtEndOfDayYmd(friDue),
      pointsPossible: 50,
      visibility: "assigned",
      createdByUserId: maria.userId,
    })
    .returning({ id: schoolAssignments.id });

  const [gradedSubmission] = await db
    .insert(schoolSubmissions)
    .values({
      assignmentId: fractionsAssignment.id,
      studentMemberId: sofia.memberId,
      status: "graded",
      submittedAt: dueAtEndOfDayYmd(addDaysYmd(wedDue, -1)),
      isLate: false,
    })
    .returning({ id: schoolSubmissions.id });

  await db.insert(schoolGrades).values({
    submissionId: gradedSubmission.id,
    score: 95,
    feedbackHtml: "<p>Great work on the word problems!</p>",
    gradedByUserId: maria.userId,
    gradedAt: new Date(),
  });

  await db.insert(schoolSubmissions).values({
    assignmentId: labAssignment.id,
    studentMemberId: lucas.memberId,
    status: "not_started",
  });

  // Turned in, waiting on Maria: gives the School page a real "to grade" count.
  await db.insert(schoolSubmissions).values([
    {
      assignmentId: fractionsAssignment.id,
      studentMemberId: lucas.memberId,
      status: "submitted",
      submittedAt: dueAtEndOfDayYmd(addDaysYmd(wedDue, -1)),
      isLate: false,
      turnInCount: 1,
    },
    {
      assignmentId: labAssignment.id,
      studentMemberId: sofia.memberId,
      status: "submitted",
      submittedAt: new Date(Date.now() - 3_600_000),
      isLate: false,
      turnInCount: 1,
    },
  ]);

  // A term's worth of mixed work: graded, late, excused, waiting to be graded, missing, upcoming.
  type SeedSubmission = {
    member: string;
    status: "graded" | "submitted" | "not_started" | "excused";
    score?: number;
    late?: boolean;
  };
  /**
   * Insert an assignment due `dueOffsetDays` from today, with one submission per entry in `subs`.
   * Graded submissions get a grade row; turned-in ones are timestamped a day before (or after, if
   * late) the due date so nothing lands in the future.
   */
  async function addAssignment(
    classId: string,
    categoryId: string,
    title: string,
    dueOffsetDays: number,
    pointsPossible: number,
    subs: SeedSubmission[],
  ): Promise<void> {
    const dueYmd = addDaysYmd(today, dueOffsetDays);
    const [assignment] = await db
      .insert(schoolAssignments)
      .values({
        classId,
        categoryId,
        title,
        instructionsHtml: "",
        dueAt: dueAtEndOfDayYmd(dueYmd),
        pointsPossible,
        visibility: "assigned",
        createdByUserId: maria.userId,
      })
      .returning({ id: schoolAssignments.id });
    for (const sub of subs) {
      const turnedIn = sub.status === "graded" || sub.status === "submitted";
      const submittedAt = turnedIn
        ? dueAtEndOfDayYmd(addDaysYmd(dueYmd, sub.late ? 1 : -1))
        : null;
      const [row] = await db
        .insert(schoolSubmissions)
        .values({
          assignmentId: assignment.id,
          studentMemberId: sub.member,
          status: sub.status,
          submittedAt,
          isLate: Boolean(sub.late),
          turnInCount: turnedIn ? 1 : 0,
        })
        .returning({ id: schoolSubmissions.id });
      if (sub.status === "graded") {
        await db.insert(schoolGrades).values({
          submissionId: row.id,
          score: sub.score,
          feedbackHtml: "",
          gradedByUserId: maria.userId,
          gradedAt: submittedAt ?? new Date(),
        });
      }
    }
  }

  const S = sofia.memberId;
  const L = lucas.memberId;
  await addAssignment(mathClass.id, homeworkCatId, "Decimals review", -24, 100, [
    { member: S, status: "graded", score: 92 },
    { member: L, status: "graded", score: 88 },
  ]);
  await addAssignment(mathClass.id, mathQuizCatId, "Ratios quiz", -17, 50, [
    { member: S, status: "graded", score: 46 },
    { member: L, status: "graded", score: 41 },
  ]);
  await addAssignment(mathClass.id, homeworkCatId, "Percent word problems", -10, 100, [
    { member: S, status: "graded", score: 100 },
    { member: L, status: "graded", score: 85, late: true },
  ]);
  await addAssignment(mathClass.id, mathTestCatId, "Unit 3 test: fractions and decimals", -6, 100, [
    { member: S, status: "graded", score: 91 },
    { member: L, status: "graded", score: 78 },
  ]);
  await addAssignment(mathClass.id, homeworkCatId, "Order of operations", -3, 100, [
    { member: S, status: "submitted" },
    { member: L, status: "not_started" },
  ]);

  await addAssignment(scienceClass.id, labCatId, "Cell parts diagram", -20, 25, [
    { member: L, status: "graded", score: 23 },
    { member: S, status: "graded", score: 25 },
  ]);
  await addAssignment(scienceClass.id, labCatId, "Microscope lab", -12, 50, [
    { member: L, status: "excused" },
    { member: S, status: "graded", score: 48 },
  ]);
  await addAssignment(scienceClass.id, sciQuizCatId, "Ecosystems quiz", -8, 20, [
    { member: L, status: "graded", score: 17 },
    { member: S, status: "graded", score: 19 },
  ]);
  await addAssignment(scienceClass.id, sciProjectCatId, "Food web poster", -2, 100, [
    { member: S, status: "submitted" },
    { member: L, status: "submitted" },
  ]);

  await addAssignment(historyClass.id, readingCatId, "Ancient Egypt reading notes", -15, 20, [
    { member: S, status: "graded", score: 19 },
    { member: L, status: "graded", score: 17 },
  ]);
  await addAssignment(historyClass.id, histQuizCatId, "Pyramids quiz", -9, 30, [
    { member: S, status: "graded", score: 27 },
    { member: L, status: "graded", score: 24 },
  ]);
  await addAssignment(historyClass.id, histProjectCatId, "Timeline project", 9, 100, [
    { member: S, status: "not_started" },
    { member: L, status: "not_started" },
  ]);

  // School days and hours over the last four weeks, so the Records page and transcript have
  // something to show. Homeschool schedules are irregular, so a few weekdays are off, and one
  // Saturday field trip counts through its logged hours alone. Relative to seed time.
  const weekdays: string[] = [];
  let saturday: string | null = null;
  for (let back = 1; weekdays.length < 20 && back < 40; back += 1) {
    const ymd = addDaysYmd(today, -back);
    const { y, m, d } = parseYmd(ymd);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 6 && saturday === null) saturday = ymd;
    if (dow !== 0 && dow !== 6) weekdays.push(ymd);
  }
  const dayRows: { householdId: string; studentMemberId: string; day: string; createdByUserId: string }[] = [];
  const hoursRows = [];
  for (const [i, ymd] of weekdays.entries()) {
    const bothOff = i === 3 || i === 7; // a sick day, a library-and-errands day
    const sofiaOff = bothOff || i === 11; // Sofia's orthodontist
    if (!sofiaOff) {
      dayRows.push({ householdId, studentMemberId: sofia.memberId, day: ymd, createdByUserId: maria.userId });
      hoursRows.push(
        { householdId, studentMemberId: sofia.memberId, classId: mathClass.id, logDate: ymd, minutes: 60, activity: "Math", note: "", createdByUserId: maria.userId },
        { householdId, studentMemberId: sofia.memberId, classId: null, logDate: ymd, minutes: 90, activity: "Reading and writing", note: "", createdByUserId: maria.userId },
      );
    }
    if (!bothOff) {
      dayRows.push({ householdId, studentMemberId: lucas.memberId, day: ymd, createdByUserId: maria.userId });
      hoursRows.push({ householdId, studentMemberId: lucas.memberId, classId: scienceClass.id, logDate: ymd, minutes: 75, activity: "Life Science", note: "", createdByUserId: maria.userId });
    }
  }
  if (saturday) {
    hoursRows.push(
      { householdId, studentMemberId: sofia.memberId, classId: null, logDate: saturday, minutes: 240, activity: "Science museum field trip", note: "", createdByUserId: maria.userId },
      { householdId, studentMemberId: lucas.memberId, classId: null, logDate: saturday, minutes: 240, activity: "Science museum field trip", note: "", createdByUserId: maria.userId },
    );
  }
  await db.insert(schoolInstructionDays).values(dayRows);
  await db.insert(schoolHoursLog).values(hoursRows);

  // —— Chores ——
  const [doneChore] = await db
    .insert(chores)
    .values({
      householdId,
      description: "Load dishwasher",
      done: true,
      dueDate: today,
      assigneeMemberId: lucas.memberId,
      createdByDisplayName: "Maria",
    })
    .returning({ id: chores.id });

  await db.insert(choreCompletions).values({
    householdId,
    choreId: doneChore.id,
    memberId: lucas.memberId,
    description: "Load dishwasher",
    dueDate: today,
    karmaEarned: 10,
    timing: "on_time",
    daysLate: 0,
  });

  await db.insert(chores).values([
    {
      householdId,
      description: "Vacuum living room",
      done: false,
      dueDate: today,
      assigneeMemberId: sofia.memberId,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      description: "Take out recycling",
      done: false,
      dueDate: yesterday,
      assigneeMemberId: members.james.memberId,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      description: "Feed cat",
      done: false,
      dueDate: today,
      assigneeMemberId: lucas.memberId,
      createdByDisplayName: "Maria",
    },
  ]);

  await db.insert(choreMemberKarma).values([
    { householdId, memberId: lucas.memberId, karmaPoints: 120, currentStreak: 3, bestStreak: 5 },
    { householdId, memberId: sofia.memberId, karmaPoints: 85, currentStreak: 1, bestStreak: 4 },
  ]);

  // —— Shopping ——
  await db.insert(shoppingItems).values([
    {
      householdId,
      item: "Bananas",
      checked: false,
      tagsJson: shoppingAisle("Produce"),
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      item: "Spinach",
      checked: false,
      tagsJson: shoppingAisle("Produce"),
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      item: "Milk",
      checked: true,
      tagsJson: shoppingAisle("Dairy"),
      createdByDisplayName: "James",
    },
    {
      householdId,
      item: "Pasta",
      checked: false,
      tagsJson: shoppingAisle("Pantry"),
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      item: "Sourdough bread",
      checked: true,
      tagsJson: shoppingAisle("Bakery"),
      createdByDisplayName: "Maria",
    },
  ]);

  // —— Expenses ——
  await db.insert(expenseBudgets).values({
    householdId,
    category: "Groceries",
    monthlyTarget: 800,
  });

  const monthStart = today.slice(0, 7);
  await db.insert(expenses).values([
    {
      householdId,
      title: "Trader Joe's",
      amount: 142.5,
      category: "Groceries",
      expenseDate: `${monthStart}-03`,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      title: "Soccer league fee",
      amount: 85,
      category: "Activities",
      expenseDate: `${monthStart}-05`,
      createdByDisplayName: "James",
    },
    {
      householdId,
      title: "Electric bill",
      amount: 124.2,
      category: "Utilities",
      expenseDate: `${monthStart}-08`,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      title: "Costco run",
      amount: 198.4,
      category: "Groceries",
      expenseDate: `${monthStart}-12`,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      title: "Curriculum books",
      amount: 67,
      category: "Activities",
      expenseDate: `${monthStart}-15`,
      createdByDisplayName: "Maria",
    },
  ]);

  // —— Notes ——
  await db.insert(notes).values([
    {
      householdId,
      title: "WiFi password",
      content: "On the router sticker in the office.",
      pinned: true,
      visibility: "household",
      createdByUserId: ownerUserId,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      title: "Co-op supply list",
      content: "- Glue sticks\n- Colored pencils\n- Lunch bag",
      pinned: false,
      visibility: "household",
      createdByUserId: ownerUserId,
      createdByDisplayName: "Maria",
    },
  ]);

  // —— Drive ——
  const [schoolFolder] = await db
    .insert(driveFolders)
    .values({ householdId, name: "School/2026" })
    .returning({ id: driveFolders.id });

  await db.insert(driveObjects).values([
    {
      householdId,
      folderId: schoolFolder.id,
      kind: "link",
      title: "Co-op spring schedule",
      url: "https://example.com/co-op-schedule",
      pinned: true,
      createdByUserId: maria.userId,
      createdByDisplayName: "Maria",
    },
    {
      householdId,
      folderId: schoolFolder.id,
      kind: "link",
      title: "Field trip permission form",
      url: "https://example.com/field-trip",
      pinned: false,
      createdByUserId: maria.userId,
      createdByDisplayName: "Maria",
    },
  ]);

  // —— Health ——
  // Dose history is written on the same slots the API derives (household timezone), so the Today
  // tab shows only what is genuinely still due.
  const nowMs = Date.now();
  type DoseOutcome = "taken" | "skipped" | "missed";
  /** Insert a daily scheduled medication for a member and return its id. */
  async function addScheduledMed(
    memberId: string,
    name: string,
    dosage: string,
    times: string[],
    instructions?: string,
  ): Promise<string> {
    const [med] = await db
      .insert(healthMedications)
      .values({
        householdId,
        memberId,
        name: encHealth(name, encryptionKey),
        dosage: encHealth(dosage, encryptionKey),
        instructions: instructions ? encHealth(instructions, encryptionKey) : null,
        scheduleKind: "scheduled",
        scheduleJson: JSON.stringify({ times, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }),
        startDate: addDaysYmd(today, -30),
        enabled: true,
        visibility: "private",
        createdByUserId: maria.userId,
      })
      .returning({ id: healthMedications.id });
    return med.id;
  }
  /**
   * Write dose history for the last `daysBack` days on the medication's scheduled slots. Slots still
   * in the future are skipped so Today shows them as due; `overrides` maps days-ago to a non-taken status.
   */
  async function logDoses(
    medicationId: string,
    times: string[],
    daysBack: number,
    overrides: Record<number, DoseOutcome> = {},
  ): Promise<void> {
    const rows = [];
    for (let back = daysBack; back >= 0; back -= 1) {
      for (const time of times) {
        const scheduledAt = chicagoInstant(addDaysYmd(today, -back), time);
        if (scheduledAt.getTime() > nowMs) continue; // still due: shows on Today
        rows.push({
          medicationId,
          scheduledAt,
          status: overrides[back] ?? ("taken" as DoseOutcome),
          loggedAt: new Date(scheduledAt.getTime() + 7 * 60_000),
          loggedByUserId: maria.userId,
          notes: null,
        });
      }
    }
    if (rows.length > 0) await db.insert(healthMedicationLogs).values(rows);
  }

  const vitaminD = await addScheduledMed(maria.memberId, "Vitamin D3", "2000 IU", ["08:00"]);
  const magnesium = await addScheduledMed(
    maria.memberId,
    "Magnesium glycinate",
    "400 mg",
    ["21:00"],
    "With water, before bed",
  );
  const vitamin = await addScheduledMed(sofia.memberId, "Daily vitamin", "1 chewable", ["08:00"]);
  const cetirizine = await addScheduledMed(lucas.memberId, "Cetirizine", "5 mg", ["20:00"], "Seasonal allergies");
  await logDoses(vitaminD, ["08:00"], 14, { 6: "skipped" });
  await logDoses(magnesium, ["21:00"], 14, { 3: "skipped", 9: "missed" });
  await logDoses(vitamin, ["08:00"], 14, { 5: "missed" });
  await logDoses(cetirizine, ["20:00"], 14);

  const [ibuprofen] = await db
    .insert(healthMedications)
    .values({
      householdId,
      memberId: lucas.memberId,
      name: encHealth("Ibuprofen", encryptionKey),
      dosage: encHealth("200mg as needed", encryptionKey),
      scheduleKind: "prn",
      scheduleJson: "{}",
      enabled: true,
      visibility: "private",
      createdByUserId: maria.userId,
    })
    .returning({ id: healthMedications.id });
  // The sick day matches the school day Lucas has off above.
  const sickDay = weekdays[3] ?? addDaysYmd(today, -5);
  await db.insert(healthMedicationLogs).values({
    medicationId: ibuprofen.id,
    scheduledAt: null,
    status: "taken",
    loggedAt: chicagoInstant(sickDay, "14:20"),
    loggedByUserId: maria.userId,
    notes: encHealth("For the head cold", encryptionKey),
  });

  /** Insert a health event (appointment, sickness, or vitals check-in) and return its id. */
  async function addHealthEvent(
    memberId: string,
    type: "appointment" | "sickness" | "vitals",
    title: string,
    startedAt: Date,
    notes?: string,
    endedAt?: Date,
  ): Promise<string> {
    const [event] = await db
      .insert(healthEvents)
      .values({
        householdId,
        memberId,
        type,
        title: encHealth(title, encryptionKey),
        notes: notes ? encHealth(notes, encryptionKey) : null,
        startedAt,
        endedAt: endedAt ?? null,
        durationKind: "single_day",
        visibility: "private",
        createdByUserId: maria.userId,
      })
      .returning({ id: healthEvents.id });
    return event.id;
  }

  await addHealthEvent(
    sofia.memberId,
    "appointment",
    "Orthodontist — Sofia",
    chicagoInstant(addDaysYmd(today, -9), "15:00"),
    "Brackets adjusted. Next visit in six weeks.",
  );
  await addHealthEvent(
    lucas.memberId,
    "appointment",
    "Well-child checkup — Lucas",
    chicagoInstant(addDaysYmd(today, -21), "09:30"),
    "Cleared for soccer. Growth on track.",
  );
  await addHealthEvent(
    lucas.memberId,
    "appointment",
    "Eye exam — Lucas",
    chicagoInstant(addDaysYmd(today, 12), "11:00"),
    "Bring current glasses",
  );
  await addHealthEvent(
    lucas.memberId,
    "sickness",
    "Head cold",
    chicagoInstant(sickDay, "07:30"),
    "Low fever and a sore throat. Rest day, no school.",
    chicagoInstant(sickDay, "20:00"),
  );

  type VitalReading = {
    metric: "weight" | "height" | "blood_pressure_systolic" | "blood_pressure_diastolic" | "heart_rate";
    value: number;
    unit: string;
  };
  /** Insert a vitals check-in event with one encrypted reading row per metric. */
  async function addVitals(
    memberId: string,
    title: string,
    offsetDays: number,
    readings: VitalReading[],
  ): Promise<void> {
    const eventId = await addHealthEvent(
      memberId,
      "vitals",
      title,
      chicagoInstant(addDaysYmd(today, offsetDays), "07:45"),
    );
    await db.insert(healthVitalsReadings).values(
      readings.map((r) => ({
        eventId,
        metric: r.metric,
        value: encHealth(String(r.value), encryptionKey),
        unit: r.unit,
      })),
    );
  }
  const mariaWeight = [152.4, 151.8, 151.0, 150.6, 150.1, 149.4, 149.0, 148.6];
  const mariaSys = [124, 122, 121, 120, 119, 118, 118, 117];
  const mariaDia = [82, 80, 80, 79, 78, 77, 76, 76];
  const mariaHr = [72, 71, 70, 70, 68, 68, 67, 66];
  for (let i = 0; i < mariaWeight.length; i += 1) {
    await addVitals(maria.memberId, "Morning vitals", -56 + i * 7, [
      { metric: "weight", value: mariaWeight[i], unit: "lb" },
      { metric: "blood_pressure_systolic", value: mariaSys[i], unit: "mmHg" },
      { metric: "blood_pressure_diastolic", value: mariaDia[i], unit: "mmHg" },
      { metric: "heart_rate", value: mariaHr[i], unit: "bpm" },
    ]);
  }
  const sofiaGrowth = [
    [57.5, 82.0],
    [58.0, 84.0],
    [58.4, 85.5],
  ];
  const lucasGrowth = [
    [52.0, 66.0],
    [52.4, 67.5],
    [52.9, 68.2],
  ];
  for (const [i, offset] of [-130, -70, -10].entries()) {
    await addVitals(sofia.memberId, "Growth check", offset, [
      { metric: "height", value: sofiaGrowth[i][0], unit: "in" },
      { metric: "weight", value: sofiaGrowth[i][1], unit: "lb" },
    ]);
    await addVitals(lucas.memberId, "Growth check", offset, [
      { metric: "height", value: lucasGrowth[i][0], unit: "in" },
      { metric: "weight", value: lucasGrowth[i][1], unit: "lb" },
    ]);
  }

  // —— Notices ——
  const [welcomeNotice] = await db
    .insert(notices)
    .values({
      householdId,
      content: "Welcome to the Rivera household demo!",
      postedByUserId: maria.userId,
      updatedByDisplayName: "Maria",
    })
    .returning({ id: notices.id });

  const [coopNotice] = await db
    .insert(notices)
    .values({
      householdId,
      content: "Co-op Thursday — bring packed lunch and water bottle.",
      postedByUserId: maria.userId,
      updatedByDisplayName: "Maria",
    })
    .returning({ id: notices.id });

  await db.insert(noticeReads).values({
    noticeId: welcomeNotice.id,
    userId: maria.userId,
  });

  // coopNotice left unread for Maria (megaphone badge)

  void coopNotice;
}
