import { describe, expect, it } from "vitest";
import { decryptSensitive, encryptSensitive } from "./index.js";

describe("encryptSensitive", () => {
  it("round-trips plaintext", () => {
    const key = "test-encryption-key-32-chars!!";
    const plain = "refresh-token-abc";
    const enc = encryptSensitive(plain, key);
    expect(enc).toMatch(/^enc:v1:/);
    expect(decryptSensitive(enc, key)).toBe(plain);
  });
});
