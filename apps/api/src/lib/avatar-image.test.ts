import { describe, expect, it } from "vitest";
import { detectAvatarMime } from "./avatar-image.js";

describe("detectAvatarMime", () => {
  it("detects jpeg", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectAvatarMime(buf)).toBe("image/jpeg");
  });

  it("detects png", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(detectAvatarMime(buf)).toBe("image/png");
  });

  it("rejects unknown", () => {
    expect(detectAvatarMime(Buffer.from([0, 1, 2, 3]))).toBeNull();
  });
});
