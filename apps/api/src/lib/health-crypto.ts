import type { Env } from "@whome/config";
import { encryptSensitive, decryptSensitive, SensitiveDecryptError } from "@whome/crypto";

export class HealthEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthEncryptionError";
  }
}

function requireKey(env: Env): string {
  const key = env.ENCRYPTION_KEY;
  if (!key) {
    throw new HealthEncryptionError("ENCRYPTION_KEY is required for health data");
  }
  return key;
}

export function encryptHealthField(plaintext: string | null | undefined, env: Env): string | null {
  if (plaintext == null) return null;
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  return encryptSensitive(trimmed, requireKey(env));
}

export function decryptHealthField(ciphertext: string | null | undefined, env: Env): string | null {
  if (ciphertext == null || ciphertext === "") return null;
  try {
    const plain = decryptSensitive(ciphertext, requireKey(env));
    return plain || null;
  } catch (e) {
    if (e instanceof SensitiveDecryptError) {
      throw new HealthEncryptionError(e.message);
    }
    throw e;
  }
}

export function decryptHealthFieldOrPassthrough(
  value: string | null | undefined,
  env: Env,
): string | null {
  if (value == null || value === "") return null;
  if (!value.startsWith("enc:v1:")) return value;
  return decryptHealthField(value, env);
}
