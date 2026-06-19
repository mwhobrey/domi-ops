import { describe, expect, it } from "vitest";
import type { Env } from "@whome/config";
import { resolveS3PresignEndpoint } from "./s3.js";

describe("resolveS3PresignEndpoint", () => {
  const base = {
    S3_BUCKET: "whome",
    S3_ENDPOINT: "http://minio:9000",
  } as Env;

  it("derives HTTPS proxy path from S3_PUBLIC_URL bucket root", () => {
    expect(
      resolveS3PresignEndpoint({
        ...base,
        S3_PUBLIC_URL: "https://whome.whobrey.me/s3/whome",
      }),
    ).toBe("https://whome.whobrey.me/s3");
  });

  it("uses local MinIO origin for dev", () => {
    expect(
      resolveS3PresignEndpoint({
        ...base,
        S3_PUBLIC_URL: "http://localhost:9000/whome",
      }),
    ).toBe("http://localhost:9000");
  });

  it("prefers S3_PUBLIC_ENDPOINT override", () => {
    expect(
      resolveS3PresignEndpoint({
        ...base,
        S3_PUBLIC_URL: "https://whome.whobrey.me/s3/whome",
        S3_PUBLIC_ENDPOINT: "https://s3.whome.whobrey.me",
      }),
    ).toBe("https://s3.whome.whobrey.me");
  });

  it("falls back to S3_ENDPOINT when public URL unset", () => {
    expect(resolveS3PresignEndpoint({ ...base, S3_PUBLIC_URL: undefined })).toBe("http://minio:9000");
  });
});
