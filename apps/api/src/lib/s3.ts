import {
  DeleteObjectCommand,
  GetObjectCommand,
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
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

export function publicObjectUrl(env: Env, key: string): string | null {
  if (!env.S3_PUBLIC_URL) return null;
  return `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}
