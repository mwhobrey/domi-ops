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
import { getObjectBuffer } from "./s3.js";
import { SchoolMaterialFreezeError } from "./school-material-freeze-errors.js";
import { downloadPublicHttpsFile } from "./safe-public-download.js";
import { authorizedMaterialDriveObject } from "./school-route-context.js";
import { storeSchoolSnapshots } from "./generated-file-storage.js";

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
    const obj = await authorizedMaterialDriveObject(db, householdId, material);
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
    const fetched = await downloadPublicHttpsFile(material.externalUrl, env.DRIVE_UPLOAD_MAX_BYTES);
    if (fetched) {
      binaryBody = fetched.body;
      contentType = fetched.contentType;
      if (contentType.startsWith("text/")) {
        plainText = fetched.body.toString("utf-8");
      }
    }
  } else if (material.source === "domi_drive_link" && material.driveObjectId) {
    const obj = await authorizedMaterialDriveObject(db, householdId, material);
    if (obj?.url) {
      const fetched = await downloadPublicHttpsFile(obj.url, env.DRIVE_UPLOAD_MAX_BYTES);
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
  if (!binaryBody && material.source !== "native_test") throw new SchoolMaterialFreezeError("material_freeze_failed", "The source could not be read safely. Use a readable Drive file, connected Google document, or public HTTPS document within the upload limit.");
  let snapshotS3Key: string | null = null;
  let snapshotTextS3Key: string | null = null;
  let snapshotContentHash: string | null = null;

  const files: { key: string; body: Buffer; contentType: string }[] = [];
  if (binaryBody) {
    files.push({ key: keys.binary, body: binaryBody, contentType });
    snapshotS3Key = keys.binary;
  }

  if (plainText) {
    const textBuf = Buffer.from(plainText, "utf-8");
    // A plain-text binary already occupies snapshot.txt: store it once.
    if (keys.text !== snapshotS3Key) files.push({ key: keys.text, body: textBuf, contentType: "text/plain; charset=utf-8" });
    snapshotTextS3Key = keys.text;
    snapshotContentHash = hashText(plainText);
  } else if (binaryBody && contentType.startsWith("text/")) {
    snapshotContentHash = hashText(binaryBody.toString("utf-8"));
  }
  await storeSchoolSnapshots(db, env, householdId, material.id, files);

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

  await db.transaction(async (transaction) => {
    const scoped = transaction as unknown as Database;
    const materials = await scoped
      .select()
      .from(schoolAssignmentMaterials)
      .where(and(
        eq(schoolAssignmentMaterials.assignmentId, assignmentId),
        eq(schoolAssignmentMaterials.isTest, true),
        isNull(schoolAssignmentMaterials.frozenAt),
      ))
      .orderBy(schoolAssignmentMaterials.id)
      .for("update");

    for (const material of materials) {
      try {
        await freezeOneMaterial(scoped, env, assignment.householdId, material);
      } catch (err) {
        if (err instanceof SchoolMaterialFreezeError) throw err;
        const message = err instanceof Error && ["quota_exceeded", "file_too_large"].includes(err.message)
          ? err.message
          : "The material snapshot could not be stored. Nothing was marked frozen; try again or contact the teacher.";
        throw new SchoolMaterialFreezeError("material_freeze_failed", message);
      }
    }
  });
}

export { hashText, normalizeTextForHash };
