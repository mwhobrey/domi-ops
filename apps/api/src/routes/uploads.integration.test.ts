import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { type AuthContext } from "@domi-ops/auth";
import { type Env, KNOWN_HOUSEHOLD_MODULES } from "@domi-ops/config";
import {
  browserUploads, closeDb, createDb, createScopedDb, driveObjects,
  householdMembers, households, schoolAssignments, schoolClasses,
  schoolSubmissionArtifacts, schoolSubmissions, users,
  schoolAssignmentMaterials,
  withHouseholdContext, withSystemContext, type Database,
} from "@domi-ops/db";
import { createTenantMiddleware } from "../middleware/tenant.js";
import type { AppVariables } from "../middleware/auth.js";
import { driveRoutes } from "./drive.js";
import { browserUploadRoutes } from "./browser-upload.js";
import { schoolUploadRoutes } from "./school-upload.js";
import { schoolAssignmentsRoutes } from "./school-assignments.js";
import { cleanupAbandonedUploads } from "../lib/upload-cleanup.js";
import { storeSchoolSnapshots } from "../lib/generated-file-storage.js";
import { reconcileHouseholdStorage } from "../lib/storage-reconciliation.js";
import { saveReportToWhomeDrive } from "../lib/report-drive-save.js";
import { schoolMaterialsRoutes } from "./school-materials.js";
import { freezeAssignmentTestMaterials } from "../lib/school-material-freeze.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;
type UploadData = { uploadUrl: string; key: string; objectId: string; publicUrl?: string };

/** Real restricted-role Postgres, tenant middleware and S3 HTTP requests; synthetic files only. */
maybeDescribe("hosted upload authorization and accounting", () => {
  let db: Database;
  let app: Hono<{ Variables: AppVariables }>;
  let server: Server;
  let env: Env;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, AuthContext> = {};
  const stored = new Map<string, Buffer>();
  const puts: { key: string; acl: string | string[] | undefined; contentType: string | undefined }[] = [];
  let submissionId: string;

  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const call = (path: string, init: RequestInit = {}, as = "alpha") => app.request(path, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-as": as } });
  const upload = (url: string, body: string, as = "alpha", contentType = "application/octet-stream") => {
    const parsed = new URL(url);
    return call(`/upload/${parsed.pathname.split("/").pop()}${parsed.search}`, { method: "PUT", body, headers: { "content-type": contentType } }, as);
  };

  beforeAll(async () => {
    db = createDb(TEST_URL!);
    server = createServer(async (req, res) => {
      const key = new URL(req.url!, "http://localhost").pathname;
      if (req.method === "HEAD") { res.writeHead(key === "/test-bucket" || stored.has(key) ? 200 : 404, { "Content-Length": stored.get(key)?.length ?? 0, "Content-Type": "text/plain" }); res.end(); return; }
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        stored.set(key, Buffer.concat(chunks));
        puts.push({ key, acl: req.headers["x-amz-acl"], contentType: req.headers["content-type"] });
        res.writeHead(200); res.end(); return;
      }
      if (req.method === "GET" && stored.has(key)) { res.writeHead(200); res.end(stored.get(key)); return; }
      if (req.method === "DELETE") { stored.delete(key); res.writeHead(204); res.end(); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    env = {
      DEPLOYMENT_MODE: "shared", NODE_ENV: "test", AUTH_REQUIRED: true,
      MODULES_ENABLED: [...KNOWN_HOUSEHOLD_MODULES], PUBLIC_APP_URL: "https://upload.test",
      SESSION_SECRET: "synthetic-upload-test-secret-thirty-two-characters",
      S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_BUCKET: "test-bucket", S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "synthetic", S3_SECRET_KEY: "synthetic", S3_FORCE_PATH_STYLE: true,
      DRIVE_UPLOAD_MAX_BYTES: 1024, DRIVE_QUOTA_WARN_PERCENT: 80, DRIVE_PUBLIC_SHARES_ENABLED: false,
    } as Env;
    await withSystemContext(db, async (tx) => {
      for (const label of ["alpha", "beta"]) {
        const [h] = await tx.insert(households).values({ name: `uploads-${randomUUID()}`, modulesEnabled: JSON.stringify(KNOWN_HOUSEHOLD_MODULES), storageQuotaBytes: 100000 }).returning();
        householdIds.push(h.id);
        for (const who of label === "alpha" ? ["alpha", "other"] : ["beta"]) {
          const [u] = await tx.insert(users).values({ username: `upload-${randomUUID()}` }).returning();
          userIds.push(u.id);
          const [m] = await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: "owner" }).returning();
          people[who] = { householdId: h.id, userId: u.id, memberId: m.id, role: "owner" } as AuthContext;
        }
      }
    });
    await withHouseholdContext(db, people.alpha.householdId, async (tx) => {
      const [cls] = await tx.insert(schoolClasses).values({ householdId: people.alpha.householdId, name: "Synthetic", teacherMemberId: people.alpha.memberId }).returning();
      const [assignment] = await tx.insert(schoolAssignments).values({ classId: cls.id, title: "Synthetic" }).returning();
      const [submission] = await tx.insert(schoolSubmissions).values({ assignmentId: assignment.id, studentMemberId: people.alpha.memberId }).returning();
      submissionId = submission.id;
    });
    const scoped = createScopedDb(db);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => { const person = people[c.req.header("x-as") ?? "alpha"]; c.set("auth", person); c.set("userId", person.userId); await next(); });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/upload", browserUploadRoutes(scoped, env));
    app.route("/drive", driveRoutes(scoped, env));
    app.route("/school/upload", schoolUploadRoutes(scoped, env));
    app.route("/school", schoolAssignmentsRoutes(scoped, env));
    app.route("/school", schoolMaterialsRoutes(scoped, env));
  }, 30000);

  afterAll(async () => {
    if (db) {
      await withSystemContext(db, async (tx) => {
        if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds));
        if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      });
      await closeDb(db);
    }
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects both another tenant's and a same-household private Drive key", async () => {
    for (const who of ["beta", "other"]) {
      const person = people[who];
      const key = `drive/${person.householdId}/${randomUUID()}/secret.txt`;
      const [object] = await withHouseholdContext(db, person.householdId, (tx) => tx.insert(driveObjects).values({ householdId: person.householdId, kind: "file", title: "Private", s3Key: key, contentType: "text/plain", byteSize: 6, visibility: "private", createdByUserId: person.userId }).returning());
      expect((await call(`/drive/objects/${object.id}/file`)).status).toBe(404);
      expect((await call(`/school/submissions/${submissionId}/artifacts`, json({ artifactType: "file", s3Key: key }))).status).toBe(400);
      const [submission] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.select().from(schoolSubmissions).where(eq(schoolSubmissions.id, submissionId)));
      expect((await call(`/school/assignments/${submission.assignmentId}/materials`, json({ role: "handout", source: "domi_drive_file", displayName: "Forged", driveObjectId: object.id }))).status).toBe(404);
      // Historical poisoned metadata must not revive the alternate download path.
      const [artifact] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.insert(schoolSubmissionArtifacts).values({ submissionId, artifactType: "file", s3Key: key }).returning());
      expect((await call(`/school/artifacts/${artifact.id}/file`)).status).toBe(404);
    }
  });

  it("shares only a teacher-authorized material and refuses to freeze a forged legacy source", async () => {
    const [submission] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.select().from(schoolSubmissions).where(eq(schoolSubmissions.id, submissionId)));
    const key = `drive/${people.alpha.householdId}/${randomUUID()}/teacher.txt`;
    stored.set(`/test-bucket/${key}`, Buffer.from("teacher"));
    const [object] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.insert(driveObjects).values({ householdId: people.alpha.householdId, kind: "file", title: "Teacher private", s3Key: key, contentType: "text/plain", byteSize: 7, visibility: "private", createdByUserId: people.alpha.userId }).returning());
    expect((await call(`/drive/objects/${object.id}/file`, {}, "other")).status).toBe(404);
    const response = await call(`/school/assignments/${submission.assignmentId}/materials`, json({ role: "handout", source: "domi_drive_file", displayName: "Explicit class sharing", driveObjectId: object.id, isTest: true }));
    expect(response.status).toBe(201);
    const { material } = await response.json() as { material: { id: string } };
    const download = await call(`/school/assignments/${submission.assignmentId}/materials/${material.id}/file`, {}, "other");
    expect(download.status).toBe(200); expect(await download.text()).toBe("teacher");
    await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.insert(schoolAssignmentMaterials).values({ assignmentId: submission.assignmentId, role: "handout", source: "domi_drive_file", displayName: "Historical forged material", driveObjectId: object.id, createdByUserId: people.other.userId, isTest: true }));
    await expect(withHouseholdContext(db, people.alpha.householdId, (tx) => freezeAssignmentTestMaterials(tx, env, submission.assignmentId))).rejects.toThrow("source could not be read safely");
    const [after] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.select().from(schoolAssignmentMaterials).where(eq(schoolAssignmentMaterials.id, material.id)));
    expect(after.frozenAt).toBeNull();
  });

  it("uploads school files privately, binds them to the uploader and allows one claim", async () => {
    const presign = await call("/school/upload/presign", json({ filename: "homework.pdf", contentType: "application/pdf" }));
    const data = await presign.json() as UploadData;
    expect(data.publicUrl).toBeUndefined();
    expect((await upload(data.uploadUrl, "school", "beta")).status).toBe(403);
    expect((await upload(data.uploadUrl, "school")).status).toBe(204);
    expect(puts.find((p) => p.key.endsWith(data.key))?.acl).toBeUndefined();
    expect((await upload(data.uploadUrl, "replay")).status).toBe(409);
    expect((await call(`/school/submissions/${submissionId}/artifacts`, json({ artifactType: "file", s3Key: data.key }), "other")).status).toBe(400);
    const attachment = await call(`/school/submissions/${submissionId}/artifacts`, json({ artifactType: "file", s3Key: data.key }));
    expect(attachment.status).toBe(201);
    const { artifact } = await attachment.json() as { artifact: { id: string } };
    const download = await call(`/school/artifacts/${artifact.id}/file`);
    expect(await download.text()).toBe("school");
    expect((await call(`/school/submissions/${submissionId}/artifacts`, json({ artifactType: "file", s3Key: data.key }))).status).toBe(400);
  });

  it("ignores forged finalization size and type and contains active content", async () => {
    const presign = await call("/drive/presign", json({ filename: "page.html", contentType: "text/html" }));
    const data = await presign.json() as UploadData;
    expect((await upload(data.uploadUrl, "<html>unsafe</html>", "alpha", "image/png")).status).toBe(204);
    const response = await call("/drive/objects", json({ id: data.objectId, kind: "file", title: "Page", s3Key: data.key, contentType: "image/png", byteSize: 0 }));
    expect(response.status).toBe(201);
    const [object] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.select().from(driveObjects).where(eq(driveObjects.id, data.objectId)));
    expect(object.byteSize).toBe(19);
    expect(object.contentType).toBe("text/html");
    const download = await call(`/drive/objects/${data.objectId}/file`);
    expect(download.headers.get("Content-Disposition")).toContain("attachment;");
    expect(download.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await call("/drive/objects", json({ kind: "file", title: "Forged", s3Key: `drive/${people.alpha.householdId}/${randomUUID()}/none`, contentType: "text/plain", byteSize: 0 }))).status).toBe(400);
  });

  it("enforces actual bytes and quota across concurrent uploads without a declared size", async () => {
    await withHouseholdContext(db, people.alpha.householdId, async (tx) => {
      const [h] = await tx.select().from(households).where(eq(households.id, people.alpha.householdId));
      await tx.update(households).set({ storageQuotaBytes: h.storageUsedBytes + 3 }).where(eq(households.id, h.id));
    });
    const grants = await Promise.all([1, 2].map(async () => (await call("/drive/presign", json({ filename: "quota.bin" }))).json() as Promise<UploadData>));
    const results = await Promise.all(grants.map((g) => upload(g.uploadUrl, "123")));
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
    const [h] = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.select().from(households).where(eq(households.id, people.alpha.householdId)));
    expect(h.storageUsedBytes).toBe(h.storageQuotaBytes);
    const rows = await withHouseholdContext(db, people.alpha.householdId, (tx) => tx.select().from(browserUploads));
    expect(rows.filter((u) => u.state !== "issued").reduce((sum, u) => sum + (u.byteSize ?? 0), 0)).toBe(h.storageUsedBytes);
    expect((await upload(grants[0].uploadUrl, "x".repeat(1025))).status).toBe(413);
  });

  it("retains charged abandoned files until cleanup deletes them and preserves attachments", async () => {
    const scoped = createScopedDb(db);
    const run = <T>(fn: () => Promise<T>) => withHouseholdContext(db, people.alpha.householdId, async (tx) => {
      const { runWithScopedDb } = await import("@domi-ops/db");
      return runWithScopedDb(tx, fn);
    });
    const before = await run(async () => {
      await scoped.update(browserUploads).set({ expiresAt: new Date(0) });
      return (await scoped.select().from(households).where(eq(households.id, people.alpha.householdId)))[0].storageUsedBytes;
    });
    const dry = await run(() => cleanupAbandonedUploads(scoped, env, people.alpha.householdId, new Date(), false));
    expect(dry.some((u) => u.byteSize === 3)).toBe(true);
    const applied = await run(() => cleanupAbandonedUploads(scoped, env, people.alpha.householdId, new Date(), true));
    expect(applied).toEqual(dry);
    const after = await run(async () => ({
      uploads: await scoped.select().from(browserUploads),
      household: (await scoped.select().from(households).where(eq(households.id, people.alpha.householdId)))[0],
    }));
    expect(after.uploads.every((u) => u.state === "consumed")).toBe(true);
    expect(after.household.storageUsedBytes).toBe(before - 3);
    expect(await run(() => cleanupAbandonedUploads(scoped, env, people.alpha.householdId, new Date(), true))).toEqual([]);
  });

  it("counts generated snapshots once on retries and serializes concurrent generated reports", async () => {
    const run = <T>(fn: (tx: Database) => Promise<T>) => withHouseholdContext(db, people.beta.householdId, fn);
    const files = [{ key: `school/${people.beta.householdId}/materials/generated/snapshot.pdf`, body: Buffer.from("1234"), contentType: "application/pdf" }];
    await run((tx) => storeSchoolSnapshots(tx, env, people.beta.householdId, "generated", files));
    await run((tx) => storeSchoolSnapshots(tx, env, people.beta.householdId, "generated", files));
    const [before] = await run((tx) => tx.select().from(households).where(eq(households.id, people.beta.householdId)));
    expect(before.storageUsedBytes).toBe(4);
    await run((tx) => tx.update(households).set({ storageQuotaBytes: 6 }).where(eq(households.id, people.beta.householdId)));
    const results = await Promise.allSettled([1, 2].map((n) => run((tx) => saveReportToWhomeDrive({ db: tx, env, householdId: people.beta.householdId, userId: people.beta.userId, moduleLabel: "Synthetic", filename: `${n}.txt`, body: Buffer.from("12"), mimeType: "text/plain", createdByLabel: "Synthetic" }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const [after] = await run((tx) => tx.select().from(households).where(eq(households.id, people.beta.householdId)));
    expect(after.storageUsedBytes).toBe(6);
  });
  it("reconciles legacy referenced bytes and provenance without changing a dry run or trusting foreign references", async () => {
    const hh = await withSystemContext(db, async (tx) => {
      const [row] = await tx.insert(households).values({ name: "Synthetic legacy reconciliation", storageUsedBytes: 999 }).returning(); householdIds.push(row.id); return row.id;
    });
    const run = <T>(fn: (tx: Database) => Promise<T>) => withHouseholdContext(db, hh, fn);
    const key = `drive/${hh}/${randomUUID()}/legacy.txt`;
    stored.set(`/test-bucket/${key}`, Buffer.from("1234567"));
    const [file] = await run((tx) => tx.insert(driveObjects).values({ householdId: hh, kind: "file", title: "Legacy", s3Key: key, byteSize: 1 }).returning());
    expect(await run((tx) => reconcileHouseholdStorage(tx, env, hh))).toMatchObject({ applied: false, previousBytes: 999, actualBytes: 7, provenanceBackfills: 1 });
    expect((await run((tx) => tx.select().from(households).where(eq(households.id, hh))))[0].storageUsedBytes).toBe(999);
    await run((tx) => reconcileHouseholdStorage(tx, env, hh, true));
    const [record] = await run((tx) => tx.select().from(browserUploads).where(eq(browserUploads.householdId, hh)));
    expect(record).toMatchObject({ purpose: "drive", state: "consumed", claimedBy: file.id, byteSize: 7 });
    expect(await run((tx) => reconcileHouseholdStorage(tx, env, hh, true))).toMatchObject({ previousBytes: 7, actualBytes: 7, provenanceBackfills: 0 });
    await run((tx) => tx.insert(driveObjects).values({ householdId: hh, kind: "file", title: "Forged legacy reference", s3Key: `drive/${people.alpha.householdId}/foreign` }));
    await expect(run((tx) => reconcileHouseholdStorage(tx, env, hh, true))).rejects.toThrow("legacy_foreign_file_reference_requires_review");
    expect((await run((tx) => tx.select().from(households).where(eq(households.id, hh))))[0].storageUsedBytes).toBe(7);
  });
});
