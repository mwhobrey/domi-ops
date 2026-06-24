import { encryptSensitive } from "@whome/crypto";
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
  healthMedicationLogs,
  healthMedications,
  notes,
  notices,
  noticeReads,
  schoolAssignmentCategories,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissions,
  shoppingItems,
} from "../schema/index.js";
import { households } from "../schema/household.js";
import {
  addDaysYmd,
  chicagoYmd,
  dueAtEndOfDayYmd,
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
      term: "2025–2026",
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
      term: "2025–2026",
      teacherMemberId: maria.memberId,
      scheduleJson: JSON.stringify({ days: ["Tue", "Thu"], time: "10:30" }),
    })
    .returning({ id: schoolClasses.id });

  await db.insert(schoolEnrollments).values([
    { classId: mathClass.id, memberId: sofia.memberId, role: "student" },
    { classId: scienceClass.id, memberId: lucas.memberId, role: "student" },
  ]);

  const [homeworkCat] = await db
    .insert(schoolAssignmentCategories)
    .values({ classId: mathClass.id, name: "Homework", weightPercent: 100 })
    .returning({ id: schoolAssignmentCategories.id });

  const [labCat] = await db
    .insert(schoolAssignmentCategories)
    .values({ classId: scienceClass.id, name: "Labs", weightPercent: 100 })
    .returning({ id: schoolAssignmentCategories.id });

  const wedDue = weekDayYmd(3);
  const friDue = weekDayYmd(5);

  const [fractionsAssignment] = await db
    .insert(schoolAssignments)
    .values({
      classId: mathClass.id,
      categoryId: homeworkCat.id,
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
      categoryId: labCat.id,
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
  const [vitamin] = await db
    .insert(healthMedications)
    .values({
      householdId,
      memberId: sofia.memberId,
      name: encHealth("Daily vitamin", encryptionKey),
      dosage: encHealth("1 chewable", encryptionKey),
      scheduleKind: "scheduled",
      scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }),
      startDate: addDaysYmd(today, -30),
      enabled: true,
      createdByUserId: maria.userId,
    })
    .returning({ id: healthMedications.id });

  await db.insert(healthMedications).values({
    householdId,
    memberId: lucas.memberId,
    name: encHealth("Ibuprofen", encryptionKey),
    dosage: encHealth("200mg as needed", encryptionKey),
    scheduleKind: "prn",
    scheduleJson: "{}",
    enabled: true,
    createdByUserId: maria.userId,
  });

  await db.insert(healthMedicationLogs).values({
    medicationId: vitamin.id,
    scheduledAt: new Date(),
    status: "taken",
    loggedByUserId: maria.userId,
    notes: encHealth("Taken with breakfast", encryptionKey),
  });

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
