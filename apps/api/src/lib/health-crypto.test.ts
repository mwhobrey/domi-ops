import type { Env } from "@whome/config";
import { encryptSensitive, decryptSensitive } from "@whome/crypto";
import { describe, expect, it } from "vitest";
import {
  decryptHealthField,
  encryptHealthField,
  HealthEncryptionError,
} from "./health-crypto.js";

const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as import("@whome/config").Env;

describe("health-crypto", () => {
  it("round-trips encrypted health fields", () => {
    const enc = encryptHealthField("Ibuprofen 200mg", env);
    expect(enc).toMatch(/^enc:v1:/);
    expect(decryptHealthField(enc, env)).toBe("Ibuprofen 200mg");
  });

  it("returns null for empty plaintext", () => {
    expect(encryptHealthField("", env)).toBeNull();
    expect(encryptHealthField("  ", env)).toBeNull();
  });

  it("throws when ENCRYPTION_KEY missing", () => {
    expect(() => encryptHealthField("x", {} as import("@whome/config").Env)).toThrow(
      HealthEncryptionError,
    );
  });

  it("does not leak ciphertext shape in decrypt round trip", () => {
    const plain = "Private symptom notes";
    const enc = encryptHealthField(plain, env)!;
    expect(enc).not.toContain(plain);
    expect(decryptHealthField(enc, env)).toBe(plain);
  });

  it("uses same crypto package as OAuth tokens", () => {
    const key = env.ENCRYPTION_KEY!;
    const viaHealth = encryptHealthField("shared", env)!;
    const viaCrypto = encryptSensitive("shared", key);
    expect(decryptSensitive(viaHealth, key)).toBe("shared");
    expect(decryptHealthField(viaCrypto, env)).toBe("shared");
  });
});
