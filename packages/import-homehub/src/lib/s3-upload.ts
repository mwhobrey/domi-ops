import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface S3ImportConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export function s3ConfigFromEnv(): S3ImportConfig | null {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) return null;
  return {
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    accessKey,
    secretKey,
    bucket: process.env.S3_BUCKET ?? "whome",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" || process.env.S3_FORCE_PATH_STYLE === "1",
  };
}

export function createImportS3Client(cfg: S3ImportConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: cfg.forcePathStyle ?? true,
  });
}

export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      /* ignore if bucket exists under other error codes from MinIO */
    }
  }
}

export async function uploadFileToS3(
  client: S3Client,
  cfg: S3ImportConfig,
  localPath: string,
  key: string,
  contentType?: string,
): Promise<void> {
  const body = readFileSync(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    }),
  );
}

export function homehubUploadPath(uploadsPath: string, filename: string): string {
  return join(uploadsPath, filename);
}

/** Stable key for imported HomeHub files */
export function importFileKey(householdId: string, sourceFileId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);
  return `imports/${householdId}/files/${sourceFileId}-${safe}`;
}

/** School artifact uploads (aligned with API presign) */
export function schoolArtifactKey(householdId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);
  return `school/${householdId}/${Date.now()}-${safe}`;
}
