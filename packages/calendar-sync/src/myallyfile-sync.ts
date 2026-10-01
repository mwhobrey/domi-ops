import { createHash } from "node:crypto";
import { myallyfileApiBase, type Env } from "@domi-ops/config";
import { decryptSensitive, encryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedicationMyallyfileSync,
  healthMedications,
  healthMyallyfileLinks,
} from "@domi-ops/db";
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";

/**
 * MyAllyFile medication sync (WHO-356/357/363, ADR 006): Domi Ops -> MyAllyFile, one way.
 * This module owns the HTTP client, the snapshot builder, and the worker scan so the API
 * (link/unlink) and the worker (push) share one contract implementation.
 */

export const MYALLYFILE_SCHEMA_VERSION = 1;
export const MYALLYFILE_MAX_MEDICATIONS = 50;
const NAME_MAX = 100;
const DOSAGE_MAX = 50;
const INSTRUCTIONS_MAX = 300;

/** Wait this long after the last change so a burst of edits becomes one push. */
export const MYALLYFILE_DEBOUNCE_MS = 15_000;
const MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
const SCAN_BATCH = 50;

export type MyallyfileErrorCode =
  | "token_invalid"
  | "token_revoked"
  | "entitlement_required"
  | "profile_not_found"
  | "validation_failed"
  | "rate_limited"
  | "code_invalid"
  | "transient";

export class MyallyfileError extends Error {
  constructor(
    readonly code: MyallyfileErrorCode,
    message: string,
    readonly opts: { status?: number; field?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "MyallyfileError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SnapshotMedication = {
  externalId: string;
  name: string;
  dosage: string | null;
  instructions: string | null;
  schedule: "scheduled" | "prn" | "otc" | "interval";
  paused: boolean;
};

export type MyallyfileLinkResult = { token: string; profileId: string; profileName: string };

const KNOWN_CODES = new Set<string>([
  "token_invalid",
  "token_revoked",
  "entitlement_required",
  "profile_not_found",
  "validation_failed",
  "rate_limited",
]);

async function callMyallyfile(
  env: Pick<Env, "DEPLOYMENT_MODE" | "MYALLYFILE_API_BASE">,
  fn: "exchangeLinkCode" | "syncMedications" | "revokeLink",
  body: unknown,
  token: string | null,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const base = myallyfileApiBase(env);
  if (!base) throw new MyallyfileError("transient", "MyAllyFile sync is not enabled here");

  let res: Response;
  try {
    res = await fetchImpl(`${base}/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MyallyfileError("transient", "MyAllyFile unreachable");
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body: fall through on status alone */
  }
  if (res.ok) return json;

  const rawCode = typeof json.code === "string" ? json.code : "";
  const status = res.status;
  if (status >= 500) throw new MyallyfileError("transient", `MyAllyFile ${status}`, { status });
  if (status === 429) {
    const retry = Number(res.headers.get("retry-after"));
    throw new MyallyfileError("rate_limited", "MyAllyFile rate limited", {
      status,
      retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : 60,
    });
  }
  if (fn === "exchangeLinkCode") {
    // The code's owner can have downgraded, or the profile can have been deleted, since it was
    // minted; those get their own states. Anything else (unknown, used, expired, malformed) is a
    // bad code.
    if (rawCode === "entitlement_required" || rawCode === "profile_not_found") {
      throw new MyallyfileError(rawCode, rawCode, { status });
    }
    throw new MyallyfileError("code_invalid", "Link code is invalid or expired", { status });
  }
  const code = (KNOWN_CODES.has(rawCode) ? rawCode : "validation_failed") as MyallyfileErrorCode;
  throw new MyallyfileError(code, rawCode || `MyAllyFile ${status}`, {
    status,
    field: typeof json.field === "string" ? json.field : undefined,
  });
}

export async function myallyfileExchangeLinkCode(
  env: Pick<Env, "DEPLOYMENT_MODE" | "MYALLYFILE_API_BASE">,
  code: string,
  instanceLabel: string,
  fetchImpl: FetchLike = fetch,
): Promise<MyallyfileLinkResult> {
  const json = await callMyallyfile(env, "exchangeLinkCode", { code, instanceLabel }, null, fetchImpl);
  if (
    typeof json.token !== "string" ||
    typeof json.profileId !== "string" ||
    typeof json.profileName !== "string"
  ) {
    throw new MyallyfileError("transient", "Unexpected MyAllyFile response");
  }
  return { token: json.token, profileId: json.profileId, profileName: json.profileName };
}

export async function myallyfileRevokeLink(
  env: Pick<Env, "DEPLOYMENT_MODE" | "MYALLYFILE_API_BASE">,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await callMyallyfile(env, "revokeLink", {}, token, fetchImpl);
}

export async function myallyfileSyncMedications(
  env: Pick<Env, "DEPLOYMENT_MODE" | "MYALLYFILE_API_BASE">,
  token: string,
  medications: SnapshotMedication[],
  sentAt: Date,
  fetchImpl: FetchLike = fetch,
): Promise<{ stale: boolean }> {
  const json = await callMyallyfile(
    env,
    "syncMedications",
    { schemaVersion: MYALLYFILE_SCHEMA_VERSION, sentAt: sentAt.toISOString(), medications },
    token,
    fetchImpl,
  );
  return { stale: json.stale === true };
}

// --- Snapshot ---------------------------------------------------------------------------------

function plain(value: string | null, env: Pick<Env, "ENCRYPTION_KEY">): string | null {
  if (value == null || value === "") return null;
  if (!value.startsWith("enc:v1:")) return value;
  if (!env.ENCRYPTION_KEY) return null;
  try {
    return decryptSensitive(value, env.ENCRYPTION_KEY) || null;
  } catch {
    return null;
  }
}

function cap(value: string | null, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, max).join("");
}

export type SnapshotSourceRow = {
  id: string;
  name: string;
  dosage: string | null;
  instructions: string | null;
  scheduleKind: "scheduled" | "prn" | "otc" | "interval";
  enabled: boolean;
};

export type SnapshotToggles = { includePrn: boolean; includeOtc: boolean; includePaused: boolean };

/** Pure: rows the user opted in -> contract payload (filtered, decrypted, capped, ordered). */
export function shapeSnapshot(
  rows: SnapshotSourceRow[],
  toggles: SnapshotToggles,
  env: Pick<Env, "ENCRYPTION_KEY">,
): SnapshotMedication[] {
  const out: SnapshotMedication[] = [];
  for (const row of rows) {
    if (row.scheduleKind === "prn" && !toggles.includePrn) continue;
    if (row.scheduleKind === "otc" && !toggles.includeOtc) continue;
    const paused = !row.enabled;
    if (paused && !toggles.includePaused) continue;
    const name = cap(plain(row.name, env), NAME_MAX);
    if (!name) continue;
    out.push({
      externalId: row.id,
      name,
      dosage: cap(plain(row.dosage, env), DOSAGE_MAX),
      instructions: cap(plain(row.instructions, env), INSTRUCTIONS_MAX),
      schedule: row.scheduleKind,
      paused,
    });
  }
  out.sort((a, b) => a.externalId.localeCompare(b.externalId));
  return out.slice(0, MYALLYFILE_MAX_MEDICATIONS);
}

export function snapshotHash(meds: SnapshotMedication[]): string {
  return createHash("sha256").update(JSON.stringify(meds)).digest("hex");
}

export async function buildMedSnapshot(
  db: Database,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: { householdId: string; memberId: string } & SnapshotToggles,
): Promise<SnapshotMedication[]> {
  const rows = await db
    .select({
      id: healthMedications.id,
      name: healthMedications.name,
      dosage: healthMedications.dosage,
      instructions: healthMedications.instructions,
      scheduleKind: healthMedications.scheduleKind,
      enabled: healthMedications.enabled,
    })
    .from(healthMedicationMyallyfileSync)
    .innerJoin(healthMedications, eq(healthMedications.id, healthMedicationMyallyfileSync.medicationId))
    .where(
      and(
        eq(healthMedications.householdId, link.householdId),
        eq(healthMedications.memberId, link.memberId),
        isNull(healthMedications.deletedAt),
      ),
    );
  return shapeSnapshot(rows, link, env);
}

// --- Outbox -----------------------------------------------------------------------------------

/**
 * Flag a member's active link for a push. Called after anything that feeds the snapshot changes.
 * Never throws: sync must not break a medication write.
 */
export async function markMyallyfileSyncNeeded(db: Database, memberId: string): Promise<void> {
  try {
    await db
      .update(healthMyallyfileLinks)
      .set({ syncRequestedAt: new Date(), nextAttemptAt: null, attempts: 0 })
      .where(and(eq(healthMyallyfileLinks.memberId, memberId), eq(healthMyallyfileLinks.status, "active")));
  } catch (e) {
    console.error("[myallyfile] could not flag sync", e instanceof Error ? e.message : e);
  }
}

export function encryptMyallyfileSecret(value: string, env: Pick<Env, "ENCRYPTION_KEY">): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required for MyAllyFile links");
  return encryptSensitive(value, env.ENCRYPTION_KEY);
}

export function decryptMyallyfileSecret(value: string, env: Pick<Env, "ENCRYPTION_KEY">): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required for MyAllyFile links");
  return decryptSensitive(value, env.ENCRYPTION_KEY);
}

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

type LinkRow = typeof healthMyallyfileLinks.$inferSelect;

async function clearPending(db: Database, link: LinkRow): Promise<void> {
  // Only clear if nothing re-flagged the link while we were pushing.
  if (!link.syncRequestedAt) return;
  await db
    .update(healthMyallyfileLinks)
    .set({ syncRequestedAt: null })
    .where(
      and(
        eq(healthMyallyfileLinks.id, link.id),
        eq(healthMyallyfileLinks.syncRequestedAt, link.syncRequestedAt),
      ),
    );
}

export async function processMyallyfileLink(
  db: Database,
  env: Env,
  link: LinkRow,
  now: Date,
  fetchImpl: FetchLike = fetch,
): Promise<"synced" | "skipped" | "failed"> {
  const meds = await buildMedSnapshot(db, env, link);
  const hash = snapshotHash(meds);

  if (link.lastSnapshotHash === hash && link.lastSyncedAt) {
    await clearPending(db, link);
    return "skipped";
  }

  try {
    const token = decryptMyallyfileSecret(link.tokenEncrypted, env);
    await myallyfileSyncMedications(env, token, meds, now, fetchImpl);
    await db
      .update(healthMyallyfileLinks)
      .set({
        lastSyncedAt: now,
        lastError: null,
        lastSnapshotHash: hash,
        attempts: 0,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(healthMyallyfileLinks.id, link.id));
    await clearPending(db, link);
    return "synced";
  } catch (e) {
    const err = e instanceof MyallyfileError ? e : new MyallyfileError("transient", "sync failed");
    const base = { lastError: err.opts.field ? `${err.code}: ${err.opts.field}` : err.code, updatedAt: now };
    switch (err.code) {
      case "token_invalid":
      case "token_revoked":
        await db.update(healthMyallyfileLinks).set({ ...base, status: "revoked", syncRequestedAt: null }).where(eq(healthMyallyfileLinks.id, link.id));
        break;
      case "entitlement_required":
        await db.update(healthMyallyfileLinks).set({ ...base, status: "entitlement_required", syncRequestedAt: null }).where(eq(healthMyallyfileLinks.id, link.id));
        break;
      case "profile_not_found":
        await db.update(healthMyallyfileLinks).set({ ...base, status: "error", syncRequestedAt: null }).where(eq(healthMyallyfileLinks.id, link.id));
        break;
      case "validation_failed":
        // Our payload was rejected: retrying the same data won't help. The next edit retries.
        await db.update(healthMyallyfileLinks).set({ ...base, syncRequestedAt: null }).where(eq(healthMyallyfileLinks.id, link.id));
        break;
      case "rate_limited":
        await db
          .update(healthMyallyfileLinks)
          .set({ ...base, nextAttemptAt: new Date(now.getTime() + (err.opts.retryAfterSec ?? 60) * 1000) })
          .where(eq(healthMyallyfileLinks.id, link.id));
        break;
      default: {
        const attempts = link.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await db.update(healthMyallyfileLinks).set({ ...base, attempts, syncRequestedAt: null }).where(eq(healthMyallyfileLinks.id, link.id));
        } else {
          await db
            .update(healthMyallyfileLinks)
            .set({ ...base, attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) })
            .where(eq(healthMyallyfileLinks.id, link.id));
        }
      }
    }
    return "failed";
  }
}

/** Worker scan: push every active link whose changes have settled past the debounce window. */
export async function scanMyallyfileSync(
  db: Database,
  env: Env,
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<{ synced: number; skipped: number; failed: number }> {
  const tally = { synced: 0, skipped: 0, failed: 0 };
  if (!myallyfileApiBase(env)) return tally;

  const due = await db
    .select()
    .from(healthMyallyfileLinks)
    .where(
      and(
        eq(healthMyallyfileLinks.status, "active"),
        isNotNull(healthMyallyfileLinks.syncRequestedAt),
        lte(healthMyallyfileLinks.syncRequestedAt, new Date(now.getTime() - MYALLYFILE_DEBOUNCE_MS)),
        or(isNull(healthMyallyfileLinks.nextAttemptAt), lte(healthMyallyfileLinks.nextAttemptAt, now)),
      ),
    )
    .limit(SCAN_BATCH);

  for (const link of due) {
    const result = await processMyallyfileLink(db, env, link, now, fetchImpl);
    tally[result] += 1;
  }
  return tally;
}
