import { createHash } from "node:crypto";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { driveObjects, schoolAssignmentMaterials, schoolAssignments, schoolClasses } from "@domi-ops/db";
import { and, eq, isNull } from "drizzle-orm";
import { exportGoogleFileForSnapshot } from "./google-drive-export.js";
import {
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "./google-docs-export.js";
import { getObjectBuffer, putObject } from "./s3.js";
import { SchoolMaterialFreezeError } from "./school-material-freeze-errors.js";

function materialSnapshotKeys(householdId: string, materialId: string, ext: string) {
  const base = `school/${householdId}/materials/${materialId}`;
  return {
    binary: `${base}/snapshot${ext}`,
    text: `${base}/snapshot.txt`,
  };
}

function extensionForContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("text/plain")) return ".txt";
  return ".bin";
}

function normalizeTextForHash(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function hashText(text: string): string {
  return createHash("sha256").update(normalizeTextForHash(text), "utf8").digest("hex");
}

async function fetchUrlBody(url: string, timeoutMs = 5000): Promise<{ body: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function freezeOneMaterial(
  db: Database,
  env: Env,
  householdId: string,
  material: typeof schoolAssignmentMaterials.$inferSelect,
): Promise<void> {
  let binaryBody: Buffer | null = null;
  let contentType = "application/octet-stream";
  let plainText = "";

  if (material.source === "domi_drive_file" && material.driveObjectId) {
    const [obj] = await db
      .select()
      .from(driveObjects)
      .where(and(eq(driveObjects.id, material.driveObjectId), eq(driveObjects.householdId, householdId)))
      .limit(1);
    if (obj?.s3Key) {
      const buf = await getObjectBuffer(env, obj.s3Key);
      if (buf) {
        binaryBody = buf;
        contentType = obj.contentType?.trim() || contentType;
        if (contentType.startsWith("text/")) {
          plainText = buf.toString("utf-8");
        }
      }
    }
  } else if (
    (material.source === "domi_drive_link" || material.source === "external_url") &&
    material.externalUrl
  ) {
    const fetched = await fetchUrlBody(material.externalUrl);
    if (fetched) {
      binaryBody = fetched.body;
      contentType = fetched.contentType;
      if (contentType.startsWith("text/")) {
        plainText = fetched.body.toString("utf-8");
      }
    }
  } else if (material.source === "domi_drive_link" && material.driveObjectId) {
    const [obj] = await db
      .select()
      .from(driveObjects)
      .where(and(eq(driveObjects.id, material.driveObjectId), eq(driveObjects.householdId, householdId)))
      .limit(1);
    if (obj?.url) {
      const fetched = await fetchUrlBody(obj.url);
      if (fetched) {
        binaryBody = fetched.body;
        contentType = fetched.contentType;
        if (contentType.startsWith("text/")) {
          plainText = fetched.body.toString("utf-8");
        }
      }
    }
  } else if (material.source === "google_doc" && material.googleFileId) {
    if (!material.createdByUserId) {
      throw new SchoolMaterialFreezeError(
        "material_freeze_failed",
        "Google material missing creator — cannot export snapshot",
      );
    }
    const conn = await loadGoogleDocsConnection(db, householdId, material.createdByUserId);
    if (!conn) {
      throw new SchoolMaterialFreezeError(
        "google_docs_not_connected",
        "Teacher must connect Google Docs before test materials can freeze",
      );
    }
    let accessToken: string;
    try {
      accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
    } catch (e) {
      if (e instanceof GoogleDocsCredentialsError) {
        throw new SchoolMaterialFreezeError("google_docs_token_revoked", e.message);
      }
      throw e;
    }
    try {
      const exported = await exportGoogleFileForSnapshot(accessToken, {
        fileId: material.googleFileId,
        mimeType: material.googleMimeType,
      });
      binaryBody = exported.binary;
      contentType = exported.contentType;
      plainText = exported.plainText;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Google export failed";
      throw new SchoolMaterialFreezeError("material_freeze_failed", message);
    }
  }

  const keys = materialSnapshotKeys(householdId, material.id, extensionForContentType(contentType));
  let snapshotS3Key: string | null = null;
  let snapshotTextS3Key: string | null = null;
  let snapshotContentHash: string | null = null;

  if (binaryBody) {
    await putObject(env, keys.binary, binaryBody, contentType);
    snapshotS3Key = keys.binary;
  }

  if (plainText) {
    const textBuf = Buffer.from(plainText, "utf-8");
    await putObject(env, keys.text, textBuf, "text/plain; charset=utf-8");
    snapshotTextS3Key = keys.text;
    snapshotContentHash = hashText(plainText);
  } else if (binaryBody && contentType.startsWith("text/")) {
    snapshotContentHash = hashText(binaryBody.toString("utf-8"));
  }

  await db
    .update(schoolAssignmentMaterials)
    .set({
      frozenAt: new Date(),
      snapshotS3Key,
      snapshotTextS3Key,
      snapshotContentHash,
    })
    .where(eq(schoolAssignmentMaterials.id, material.id));
}

/** Freeze all unfrozen is_test materials on an assignment. Idempotent. */
export async function freezeAssignmentTestMaterials(
  db: Database,
  env: Env,
  assignmentId: string,
): Promise<void> {
  const [assignment] = await db
    .select({
      id: schoolAssignments.id,
      householdId: schoolClasses.householdId,
    })
    .from(schoolAssignments)
    .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
    .where(eq(schoolAssignments.id, assignmentId))
    .limit(1);
  if (!assignment) return;

  const materials = await db
    .select()
    .from(schoolAssignmentMaterials)
    .where(
      and(
        eq(schoolAssignmentMaterials.assignmentId, assignmentId),
        eq(schoolAssignmentMaterials.isTest, true),
        isNull(schoolAssignmentMaterials.frozenAt),
      ),
    );

  for (const material of materials) {
    try {
      await freezeOneMaterial(db, env, assignment.householdId, material);
    } catch (err) {
      if (material.source === "google_doc") throw err;
      console.error("school material freeze failed", material.id, err);
      await db
        .update(schoolAssignmentMaterials)
        .set({ frozenAt: new Date() })
        .where(eq(schoolAssignmentMaterials.id, material.id));
    }
  }
}

export { hashText, normalizeTextForHash };
