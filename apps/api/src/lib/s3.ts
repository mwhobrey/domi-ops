import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "@whome/config";

export function createS3Client(env: Env): S3Client | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? true,
  });
}

function normalizeContentType(contentType: string | undefined): string {
  const trimmed = contentType?.trim();
  return trimmed ? trimmed : "application/octet-stream";
}

let s3Ready: Promise<void> | null = null;

/** Idempotent: create bucket if missing (browser CORS: run scripts/ensure-minio.mjs). */
export async function ensureS3Bucket(env: Env): Promise<void> {
  const client = createS3Client(env);
  if (!client || !env.S3_BUCKET) throw new Error("s3_not_configured");

  try {
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
    }
  }
}

export function ensureS3ReadyOnce(env: Env): Promise<void> {
  if (!s3Ready) {
    s3Ready = ensureS3Bucket(env).catch((err) => {
      s3Ready = null;
      throw err;
    });
  }
  return s3Ready;
}

export async function putObject(
  env: Env,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = createS3Client(env);
  if (!client || !env.S3_BUCKET) throw new Error("s3_not_configured");
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(env: Env, key: string): Promise<void> {
  const client = createS3Client(env);
  if (!client || !env.S3_BUCKET) return;
  await client.send(
    new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
}

export async function getObjectBuffer(env: Env, key: string): Promise<Buffer | null> {
  const client = createS3Client(env);
  if (!client || !env.S3_BUCKET) return null;
  const res = await client.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
  if (!res.Body) return null;
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function presignedPutUrl(
  env: Env,
  key: string,
  contentType: string,
  expiresIn = 15 * 60,
): Promise<string> {
  const client = createS3Client(env);
  if (!client || !env.S3_BUCKET) throw new Error("s3_not_configured");
  const type = normalizeContentType(contentType);
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: type,
    }),
    { expiresIn },
  );
}

export function publicObjectUrl(env: Env, key: string): string | null {
  if (!env.S3_PUBLIC_URL) return null;
  return `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function contentTypeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return (ext && CONTENT_TYPE_BY_EXT[ext]) || "application/octet-stream";
}
