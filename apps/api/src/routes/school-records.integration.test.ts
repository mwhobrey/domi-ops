import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  householdMembers,
  households,
  schoolAssignmentCategories,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissions,
  users,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { schoolRecordsRoutes } from "./school-records.js";

/**
 * WHO-347: attendance, hours log and transcript routes against a real Postgres. Auth is faked by
 * a parent app that sets `auth` per request via the `x-as` header; everything below it (school
 * context, class access, scoping) is the real code. Needs migration 0080 applied. Skipped
 * without a database.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = { MODULES_ENABLED: ["core", "school"], DEPLOYMENT_MODE: "single", AUTH_REQUIRED: true } as unknown as Env;

maybeDescribe("school records routes (integration)", () => {
  let db: Database;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  let app: Hono<{ Variables: AppVariables }>;

  type Person = { userId: string; memberId: string; householdId: string; role: "owner" | "child" };
  const people: Record<string, Person> = {};
  let classId = "";
  let otherClassId = "";

  async function seedHousehold(name: string, people2: { key: string; role: "owner" | "child" }[]) {
    return withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "school"]) })
        .returning({ id: households.id });
      householdIds.push(hh.id);
      for (const p of people2) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who347-${randomUUID()}@test.local`, displayName: p.key, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u.id);
        const [m] = await tx
          .insert(householdMembers)
          .values({ householdId: hh.id, userId: u.id, role: p.role, name: p.key })
          .returning({ id: householdMembers.id });
        people[p.key] = { userId: u.id, memberId: m.id, householdId: hh.id, role: p.role };
      }
      return hh.id;
    });
  }

  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "x-as": as, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);

    const hh = await seedHousehold("who347-home", [
      { key: "parent", role: "owner" },
      { key: "kid", role: "child" },
      { key: "sibling", role: "child" },
    ]);
    await seedHousehold("who347-other", [{ key: "stranger", role: "owner" }]);

    await withSystemContext(db, async (tx) => {
      const [cls] = await tx
        .insert(schoolClasses)
        .values({
          householdId: hh,
          name: "Algebra",
          term: "2025-2026",
          credits: 1,
          teacherMemberId: people.parent!.memberId,
        })
        .returning({ id: schoolClasses.id });
      classId = cls.id;
      const [cls2] = await tx
        .insert(schoolClasses)
        .values({
          householdId: hh,
          name: "Art",
          term: "2025-2026",
          credits: 0.5,
          teacherMemberId: people.parent!.memberId,
        })
        .returning({ id: schoolClasses.id });
      otherClassId = cls2.id;

      // kid is enrolled in both, sibling only in Art. Kid's Algebra enrollment already ended.
      await tx.insert(schoolEnrollments).values([
        { classId, memberId: people.kid!.memberId, role: "student", activeTo: "2025-06-01" },
        { classId: otherClassId, memberId: people.kid!.memberId, role: "student" },
        { classId: otherClassId, memberId: people.sibling!.memberId, role: "student" },
      ]);

      // Algebra: homework 50% (90/100), tests 50% (70/100) => weighted 80.
      const [homework] = await tx
        .insert(schoolAssignmentCategories)
        .values({ classId, name: "Homework", weightPercent: 50 })
        .returning({ id: schoolAssignmentCategories.id });
      const [tests] = await tx
        .insert(schoolAssignmentCategories)
        .values({ classId, name: "Tests", weightPercent: 50 })
        .returning({ id: schoolAssignmentCategories.id });
      for (const [title, categoryId, score] of [
        ["HW 1", homework.id, 90],
        ["Test 1", tests.id, 70],
      ] as const) {
        const [a] = await tx
          .insert(schoolAssignments)
          .values({ classId, categoryId, title, pointsPossible: 100, visibility: "assigned" })
          .returning({ id: schoolAssignments.id });
        const [s] = await tx
          .insert(schoolSubmissions)
          .values({ assignmentId: a.id, studentMemberId: people.kid!.memberId, status: "graded" })
          .returning({ id: schoolSubmissions.id });
        await tx.insert(schoolGrades).values({ submissionId: s.id, score, gradedAt: new Date() });
      }
    });

    const inner = schoolRecordsRoutes(db, env);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      const who = people[c.req.header("x-as") ?? ""];
      c.set("userId", who?.userId ?? null);
      c.set(
        "auth",
        who
          ? {
              userId: who.userId,
              householdId: who.householdId,
              memberId: who.memberId,
              email: null,
              username: null,
              name: null,
              role: who.role,
            }
          : null,
      );
      return next();
    });
    app.route("/", inner);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(db);
  });

  describe("attendance", () => {
    it("lets a parent mark a day and read it back", async () => {
      const put = await call("parent", "PUT", `/classes/${otherClassId}/attendance`, {
        date: "2025-10-01",
        entries: [
          { studentMemberId: people.kid!.memberId, status: "present" },
          { studentMemberId: people.sibling!.memberId, status: "absent", note: "sick" },
        ],
      });
      expect(put.status).toBe(200);

      const get = await call("parent", "GET", `/classes/${otherClassId}/attendance`);
      const { attendance, canEdit } = (await get.json()) as { attendance: { status: string }[]; canEdit: boolean };
      expect(attendance).toHaveLength(2);
      expect(canEdit).toBe(true);
    });

    it("updates in place instead of duplicating, and clears with null", async () => {
      await call("parent", "PUT", `/classes/${otherClassId}/attendance`, {
        date: "2025-10-01",
        entries: [{ studentMemberId: people.sibling!.memberId, status: "excused" }],
      });
      let get = await call("parent", "GET", `/classes/${otherClassId}/attendance?from=2025-10-01&to=2025-10-01`);
      let rows = ((await get.json()) as { attendance: { studentMemberId: string; status: string }[] }).attendance;
      expect(rows.find((r) => r.studentMemberId === people.sibling!.memberId)?.status).toBe("excused");
      expect(rows).toHaveLength(2);

      await call("parent", "PUT", `/classes/${otherClassId}/attendance`, {
        date: "2025-10-01",
        entries: [{ studentMemberId: people.sibling!.memberId, status: null }],
      });
      get = await call("parent", "GET", `/classes/${otherClassId}/attendance?from=2025-10-01&to=2025-10-01`);
      rows = ((await get.json()) as { attendance: { studentMemberId: string; status: string }[] }).attendance;
      expect(rows).toHaveLength(1);
    });

    it("shows a student only their own rows and blocks their writes", async () => {
      const get = await call("kid", "GET", `/classes/${otherClassId}/attendance`);
      const { attendance, canEdit } = (await get.json()) as {
        attendance: { studentMemberId: string }[];
        canEdit: boolean;
      };
      expect(attendance.every((r) => r.studentMemberId === people.kid!.memberId)).toBe(true);
      expect(canEdit).toBe(false);

      const put = await call("kid", "PUT", `/classes/${otherClassId}/attendance`, {
        date: "2025-10-02",
        entries: [{ studentMemberId: people.kid!.memberId, status: "present" }],
      });
      expect(put.status).toBe(403);
    });

    it("rejects bad input", async () => {
      const path = `/classes/${otherClassId}/attendance`;
      const kid = people.kid!.memberId;
      expect((await call("parent", "PUT", path, { date: "2025-02-30", entries: [{ studentMemberId: kid, status: "present" }] })).status).toBe(400);
      expect((await call("parent", "PUT", path, { date: "2025-10-02", entries: [{ studentMemberId: kid, status: "tardy" }] })).status).toBe(400);
      // Parent is not an enrolled student, so can't be marked.
      expect((await call("parent", "PUT", path, { date: "2025-10-02", entries: [{ studentMemberId: people.parent!.memberId, status: "present" }] })).status).toBe(400);
      expect((await call("parent", "GET", `${path}?from=nope`)).status).toBe(400);
    });

    it("hides another household's class", async () => {
      const res = await call("stranger", "GET", `/classes/${otherClassId}/attendance`);
      expect(res.status).toBe(404);
    });
  });

  describe("hours log", () => {
    it("lets a parent log, edit and delete hours", async () => {
      const post = await call("parent", "POST", "/hours", {
        studentMemberId: people.kid!.memberId,
        classId,
        logDate: "2025-10-01",
        minutes: 90,
        activity: "Reading",
      });
      expect(post.status).toBe(201);
      const { entry } = (await post.json()) as { entry: { id: string } };

      const patch = await call("parent", "PATCH", `/hours/${entry.id}`, { minutes: 120 });
      expect(patch.status).toBe(200);

      const rec = await call("parent", "GET", `/records/${people.kid!.memberId}`);
      const body = (await rec.json()) as { hours: { totalMinutes: number; totalHours: number } };
      expect(body.hours).toMatchObject({ totalMinutes: 120, totalHours: 2 });

      expect((await call("parent", "DELETE", `/hours/${entry.id}`)).status).toBe(200);
    });

    it("blocks students from writing and validates input", async () => {
      const kid = people.kid!.memberId;
      expect((await call("kid", "POST", "/hours", { studentMemberId: kid, logDate: "2025-10-01", minutes: 30 })).status).toBe(403);
      expect((await call("parent", "POST", "/hours", { studentMemberId: kid, logDate: "2025-10-01", minutes: 0 })).status).toBe(400);
      expect((await call("parent", "POST", "/hours", { studentMemberId: kid, logDate: "bad", minutes: 30 })).status).toBe(400);
      expect((await call("parent", "POST", "/hours", { studentMemberId: kid, logDate: "2025-10-01", minutes: 30, classId: randomUUID() })).status).toBe(400);
    });

    it("keeps one household's students out of reach of another", async () => {
      const kid = people.kid!.memberId;
      expect((await call("stranger", "POST", "/hours", { studentMemberId: kid, logDate: "2025-10-01", minutes: 30 })).status).toBe(403);
      expect((await call("stranger", "GET", `/records/${kid}`)).status).toBe(404);
    });
  });

  describe("records visibility", () => {
    it("lets a student see only themselves", async () => {
      const list = await call("kid", "GET", "/records/students");
      const { students } = (await list.json()) as { students: { memberId: string; canEdit: boolean }[] };
      expect(students).toEqual([expect.objectContaining({ memberId: people.kid!.memberId, canEdit: false })]);
      expect((await call("kid", "GET", `/records/${people.sibling!.memberId}`)).status).toBe(404);
    });

    it("lets the owner see every enrolled student", async () => {
      const list = await call("parent", "GET", "/records/students");
      const { students } = (await list.json()) as { students: { memberId: string }[] };
      expect(students.map((s) => s.memberId).sort()).toEqual(
        [people.kid!.memberId, people.sibling!.memberId].sort(),
      );
    });
  });

  describe("transcript", () => {
    it("weights the final grade and includes a class whose enrollment ended", async () => {
      const res = await call("parent", "GET", `/transcript/${people.kid!.memberId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        householdName: string;
        transcript: {
          gpa: number | null;
          creditsEarned: number;
          terms: { term: string; courses: { name: string; finalPercent: number | null; letter: string | null; inProgress: boolean }[] }[];
        };
      };
      expect(body.householdName).toBe("who347-home");
      const courses = body.transcript.terms[0]!.courses;
      const algebra = courses.find((c) => c.name === "Algebra")!;
      expect(algebra).toMatchObject({ finalPercent: 80, letter: "B" });
      // Art has nothing graded yet: listed, but no credit and no GPA effect.
      expect(courses.find((c) => c.name === "Art")).toMatchObject({ inProgress: true, letter: null });
      expect(body.transcript.gpa).toBe(3);
      expect(body.transcript.creditsEarned).toBe(1);
    });

    it("lets a student view their own but not a sibling's", async () => {
      expect((await call("kid", "GET", `/transcript/${people.kid!.memberId}`)).status).toBe(200);
      expect((await call("kid", "GET", `/transcript/${people.sibling!.memberId}`)).status).toBe(404);
    });
  });
});
