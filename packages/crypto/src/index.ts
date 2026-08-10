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
  let start = 0;
  let end = decrypted.length;
  while (end > start && decrypted[end - 1] === 0) end--;
  if (end > start && decrypted[start] === 0x80) start++;
  return decrypted.subarray(start, end).toString("utf8");
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

/** Allowed dose statuses for interactive med push actions (WHO-235). */
export type HealthMedPushActionStatus = "taken" | "skipped";

export type HealthMedPushActionClaims = {
  v: 1;
  householdId: string;
  userId: string;
  medicationId: string;
  /** ISO scheduled instant for the dose. */
  scheduledAt: string;
  actions: HealthMedPushActionStatus[];
  /** Unix seconds. */
  exp: number;
};

const HEALTH_MED_PUSH_TOKEN_TTL_SEC = 4 * 60 * 60;

function signHealthMedPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Mint a short-lived HMAC token for med reminder push actions.
 * Prefer ENCRYPTION_KEY; SESSION_SECRET is an acceptable fallback in local/dev.
 */
export function mintHealthMedPushActionToken(
  input: {
    householdId: string;
    userId: string;
    medicationId: string;
    scheduledAt: string;
    actions?: HealthMedPushActionStatus[];
    ttlSeconds?: number;
  },
  secret: string,
  nowMs = Date.now(),
): string {
  if (!secret) throw new Error("health_med_push_token_secret_required");
  const ttl = input.ttlSeconds ?? HEALTH_MED_PUSH_TOKEN_TTL_SEC;
  const claims: HealthMedPushActionClaims = {
    v: 1,
    householdId: input.householdId,
    userId: input.userId,
    medicationId: input.medicationId,
    scheduledAt: input.scheduledAt,
    actions: input.actions ?? ["taken", "skipped"],
    exp: Math.floor(nowMs / 1000) + ttl,
  };
  const payloadB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = signHealthMedPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

/** Verify signature + expiry; returns claims or null. */
export function verifyHealthMedPushActionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): HealthMedPushActionClaims | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signHealthMedPayload(payloadB64, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !sigBuf.equals(expBuf)) return null;
  let claims: HealthMedPushActionClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as HealthMedPushActionClaims;
  } catch {
    return null;
  }
  if (claims.v !== 1) return null;
  if (
    typeof claims.householdId !== "string" ||
    typeof claims.userId !== "string" ||
    typeof claims.medicationId !== "string" ||
    typeof claims.scheduledAt !== "string" ||
    typeof claims.exp !== "number" ||
    !Array.isArray(claims.actions)
  ) {
    return null;
  }
  if (claims.exp < Math.floor(nowMs / 1000)) return null;
  if (Number.isNaN(Date.parse(claims.scheduledAt))) return null;
  const actions = claims.actions.filter(
    (a): a is HealthMedPushActionStatus => a === "taken" || a === "skipped",
  );
  if (actions.length === 0) return null;
  return { ...claims, actions };
}

/** Resolve signing secret for med push tokens. */
export function healthMedPushActionSecret(env: {
  ENCRYPTION_KEY?: string;
  SESSION_SECRET?: string;
}): string | null {
  return env.ENCRYPTION_KEY || env.SESSION_SECRET || null;
}
