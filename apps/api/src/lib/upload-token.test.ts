import { describe, expect, it } from "vitest";
import {
  browserUploadPutUrl,
  signBrowserUploadToken,
  verifyBrowserUploadToken,
} from "./upload-token.js";

const secret = "test-secret-min-32-chars-for-hmac!!";

describe("browser upload token", () => {
  const grant = {
    uploadId: "obj-1",
    key: "drive/hh/obj/file.png",
    householdId: "hh-1",
    memberId: "mem-1",
    contentType: "image/png",
    maxBytes: 10_485_760,
  };

  it("round-trips sign and verify", () => {
    const token = signBrowserUploadToken(secret, grant, 900);
    const parsed = verifyBrowserUploadToken(secret, token);
    expect(parsed.uploadId).toBe(grant.uploadId);
    expect(parsed.key).toBe(grant.key);
  });

  it("builds same-origin API upload URL", () => {
    const url = browserUploadPutUrl(
      { PUBLIC_APP_URL: "https://whome.whobrey.me", SESSION_SECRET: secret },
      grant,
    );
    expect(url).toMatch(/^https:\/\/whome\.whobrey\.me\/api\/core\/upload\/obj-1\?token=/);
  });

  it("rejects tampered token", () => {
    const token = signBrowserUploadToken(secret, grant, 900);
    expect(() => verifyBrowserUploadToken(secret, `${token}x`)).toThrow();
  });
});
