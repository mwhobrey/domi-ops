/**
 * Fernet-compatible encrypt/decrypt (port of HomeHub sensitive_store.py).
 * Uses SHA-256(ENCRYPTION_KEY) → url-safe base64 key for AES-128-CBC + HMAC.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

export class SensitiveDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SensitiveDecryptError";
  }
}

function fernetKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** HomeHub-compatible Fernet token (simplified: AES-128-CBC + HMAC-SHA256) */
function fernetEncrypt(plaintext: string, secret: string): string {
  const key = fernetKey(secret);
  const signingKey = key.subarray(0, 16);
  const encKey = key.subarray(16, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", encKey, iv);
  const padded = Buffer.concat([
    Buffer.from([0x80]),
    Buffer.from(plaintext, "utf8"),
  ]);
  let data = padded;
  const padLen = 16 - (data.length % 16);
  if (padLen < 16) {
    data = Buffer.concat([data, Buffer.alloc(padLen, 0)]);
  }
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const version = Buffer.from([0x80]);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 0);
  const token = Buffer.concat([version, timestamp, iv, ciphertext]);
  const hmac = createHmac("sha256", signingKey).update(token).digest();
  const combined = Buffer.concat([token, hmac]);
  return PREFIX + combined.toString("base64url");
}

function fernetDecrypt(value: string, secret: string): string {
  if (!value.startsWith(PREFIX)) {
    return value;
  }
  const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (raw.length < 57) {
    throw new SensitiveDecryptError("Invalid encrypted token");
  }
  const key = fernetKey(secret);
  const signingKey = key.subarray(0, 16);
  const encKey = key.subarray(16, 32);
  const token = raw.subarray(0, raw.length - 32);
  const hmac = raw.subarray(raw.length - 32);
  const expected = createHmac("sha256", signingKey).update(token).digest();
  if (!hmac.equals(expected)) {
    throw new SensitiveDecryptError(
      "Cannot decrypt stored secret — ENCRYPTION_KEY likely changed. Reconnect Google Calendar.",
    );
  }
  const iv = token.subarray(9, 25);
  const ciphertext = token.subarray(25);
  const decipher = createDecipheriv("aes-128-cbc", encKey, iv);
  let decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0) end--;
  if (end > 0 && decrypted[end - 1] === 0x80) end--;
  return decrypted.subarray(0, end).toString("utf8");
}

export function encryptSensitive(value: string, encryptionKey: string): string {
  if (!value) return value;
  return fernetEncrypt(value, encryptionKey);
}

export function decryptSensitive(value: string, encryptionKey: string): string {
  if (!value) return value;
  if (!value.startsWith(PREFIX)) return value;
  try {
    return fernetDecrypt(value, encryptionKey);
  } catch (e) {
    if (e instanceof SensitiveDecryptError) throw e;
    throw new SensitiveDecryptError(
      "Cannot decrypt stored secret — ENCRYPTION_KEY likely changed since data was saved.",
    );
  }
}
