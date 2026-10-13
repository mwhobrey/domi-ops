import { withingsCredentials, type Env } from "@domi-ops/config";
import { decryptSensitive, encryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthVitalsReadings,
  healthWithingsLinks,
  healthWithingsMeasureGroups,
  withHouseholdContext,
} from "@domi-ops/db";
import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { enqueueForHouseholds, type EnqueueHouseholdScan } from "./household-scan-fanout.js";

/**
 * Withings blood pressure sync (WHO-452): Withings -> Domi Ops, one way. Readings become ordinary
 * `vitals` health events, so scheduled check slots resolve through the existing tolerance window
 * (docs/HEALTH_CHECKS.md) with no matcher of our own. This module owns the HTTP client, the pure
 * measure-group shaping, the import, and the household-scoped sync the worker runs.
 */

const AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
const MEASURE_URL = "https://wbsapi.withings.net/measure";
const NOTIFY_URL = "https://wbsapi.withings.net/notify";

export const WITHINGS_SCOPE = "user.metrics";
/** Notify category 4: blood pressure and heart rate. */
export const WITHINGS_APPLI_BLOOD_PRESSURE = 4;

export const WITHINGS_DEFAULT_BACKFILL_DAYS = 365;
export const WITHINGS_MAX_BACKFILL_DAYS = 3650;

/** A link with no webhook for this long is pulled anyway, so a missed notification heals itself. */
export const WITHINGS_SAFETY_NET_MS = 6 * 60 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
/** While a worker holds a link its `next_attempt_at` is pushed out this far; a crash frees it afterwards. */
const LEASE_MS = 10 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const NOT_CONFIGURED_BACKOFF_MS = 60 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_PAGES = 200;
const HOUSEHOLD_BATCH = 20;

/**
 * Withings `status` values that mean "this token will never work again": the user has to re-link.
 * 343 ("OAuth access token absent or invalid") is in Withings' published table; since the token is
 * refreshed before use, seeing it means the grant was withdrawn. 401 and 293 are from memory, not
 * the table. 342 ("credentials absent or incorrect") is left out on purpose: it can mean our own app
 * secret is wrong, and that must not flip every link to "reconnect"; it retries, then lands in `error`,
 * which "Sync now" recovers. Confirmed: 601 is "Too Many Requests".
 */
const TOKEN_INVALID_STATUSES = new Set([343, 401, 293]);
const RATE_LIMIT_STATUS = 601;

export type WithingsErrorCode = "not_configured" | "token_invalid" | "rate_limited" | "transient";

export class WithingsError extends Error {
  constructor(
    readonly code: WithingsErrorCode,
    message: string,
    readonly opts: { status?: number } = {},
  ) {
    super(message);
    this.name = "WithingsError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// --- Secrets ----------------------------------------------------------------------------------

export function encryptWithingsSecret(value: string, env: Pick<Env, "ENCRYPTION_KEY">): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required for Withings links");
  return encryptSensitive(value, env.ENCRYPTION_KEY);
}

export function decryptWithingsSecret(value: string, env: Pick<Env, "ENCRYPTION_KEY">): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required for Withings links");
  return decryptSensitive(value, env.ENCRYPTION_KEY);
}

// --- HTTP client ------------------------------------------------------------------------------

/**
 * Withings answers HTTP 200 with a `status` field in the JSON; 0 is success. Anything else is mapped
 * to the three outcomes the sync cares about. The token-invalid list is the part to confirm against
 * Withings' current error table if a link ever shows up revoked unexpectedly.
 */
async function callWithings(
  url: string,
  form: Record<string, string>,
  bearer: string | null,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new WithingsError("transient", "Withings unreachable");
  }
  if (res.status === 429) throw new WithingsError("rate_limited", "Withings rate limited", { status: 429 });
  if (res.status >= 500) throw new WithingsError("transient", `Withings ${res.status}`, { status: res.status });

  let json: { status?: unknown; body?: unknown } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new WithingsError("transient", `Withings returned a non-JSON ${res.status}`, { status: res.status });
  }
  const status = typeof json.status === "number" ? json.status : -1;
  if (status === 0) return (json.body ?? {}) as Record<string, unknown>;
  if (status === RATE_LIMIT_STATUS) throw new WithingsError("rate_limited", "Withings rate limited", { status });
  if (TOKEN_INVALID_STATUSES.has(status)) throw new WithingsError("token_invalid", `Withings status ${status}`, { status });
  throw new WithingsError("transient", `Withings status ${status}`, { status });
}

export type WithingsTokens = { userId: string; accessToken: string; refreshToken: string; expiresInSec: number; scope: string | null };

function parseTokens(body: Record<string, unknown>): WithingsTokens {
  const userId = body.userid;
  if (
    (typeof userId !== "string" && typeof userId !== "number") ||
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string" ||
    typeof body.expires_in !== "number"
  ) {
    throw new WithingsError("transient", "Unexpected Withings token response");
  }
  return {
    userId: String(userId),
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSec: body.expires_in,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

function requireCredentials(env: Pick<Env, "WITHINGS_CLIENT_ID" | "WITHINGS_CLIENT_SECRET">) {
  const creds = withingsCredentials(env);
  if (!creds) throw new WithingsError("not_configured", "Withings is not configured on this deployment");
  return creds;
}

export function withingsAuthorizeUrl(
  env: Pick<Env, "WITHINGS_CLIENT_ID" | "WITHINGS_CLIENT_SECRET">,
  input: { redirectUri: string; state: string },
): string {
  const { clientId } = requireCredentials(env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", WITHINGS_SCOPE);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function withingsExchangeCode(
  env: Pick<Env, "WITHINGS_CLIENT_ID" | "WITHINGS_CLIENT_SECRET">,
  code: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<WithingsTokens> {
  const { clientId, clientSecret } = requireCredentials(env);
  const body = await callWithings(
    TOKEN_URL,
    {
      action: "requesttoken",
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    },
    null,
    fetchImpl,
  );
  return parseTokens(body);
}

async function withingsRefresh(
  env: Pick<Env, "WITHINGS_CLIENT_ID" | "WITHINGS_CLIENT_SECRET">,
  refreshToken: string,
  fetchImpl: FetchLike,
): Promise<WithingsTokens> {
  const { clientId, clientSecret } = requireCredentials(env);
  const body = await callWithings(
    TOKEN_URL,
    {
      action: "requesttoken",
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    },
    null,
    fetchImpl,
  );
  return parseTokens(body);
}

/** Ask Withings to POST to `callbackUrl` when this user has new blood pressure data. */
export async function withingsSubscribe(accessToken: string, callbackUrl: string, fetchImpl: FetchLike = fetch): Promise<void> {
  await callWithings(
    NOTIFY_URL,
    { action: "subscribe", callbackurl: callbackUrl, appli: String(WITHINGS_APPLI_BLOOD_PRESSURE) },
    accessToken,
    fetchImpl,
  );
}

export async function withingsUnsubscribe(accessToken: string, callbackUrl: string, fetchImpl: FetchLike = fetch): Promise<void> {
  await callWithings(
    NOTIFY_URL,
    { action: "revoke", callbackurl: callbackUrl, appli: String(WITHINGS_APPLI_BLOOD_PRESSURE) },
    accessToken,
    fetchImpl,
  );
}

// --- Measure groups ---------------------------------------------------------------------------

export type WithingsMeasure = { value: number; type: number; unit: number };
export type WithingsMeasureGroup = {
  grpid: number | string;
  /** Unix seconds the reading was taken. */
  date: number;
  /** How Withings attributed the group to this user (see `UNATTRIBUTED_ATTRIBS`). */
  attrib?: number;
  measures?: WithingsMeasure[];
};

/**
 * `attrib` 1: captured by a device but "may belong to other users as well as this one (it is
 * ambiguous)". 4: entered manually during user creation, "may not be accurate". Both are left out, so
 * a cuff shared by a household cannot put one person's reading in another's record. They are not
 * remembered either: once the person assigns it in the Withings app the group comes back (updated)
 * with a firmer `attrib` and is imported then. Everything else is imported: 0 and 8 (known to
 * belong to this user), 2 (typed in for this user), 5 (blood pressure monitor's computed best value),
 * 7 and 15.
 */
const UNATTRIBUTED_ATTRIBS = new Set([1, 4]);

export type BloodPressureMetric = "blood_pressure_systolic" | "blood_pressure_diastolic" | "heart_rate";
export type ShapedBloodPressure = {
  grpid: string;
  measuredAt: Date;
  readings: Array<{ metric: BloodPressureMetric; value: number; unit: "mmHg" | "bpm" }>;
};

/** Withings measure types: 9 diastolic, 10 systolic, 11 heart pulse. */
const MEASURE_TYPE_TO_METRIC: Record<number, { metric: BloodPressureMetric; unit: "mmHg" | "bpm" }> = {
  9: { metric: "blood_pressure_diastolic", unit: "mmHg" },
  10: { metric: "blood_pressure_systolic", unit: "mmHg" },
  11: { metric: "heart_rate", unit: "bpm" },
};
const MEASURE_TYPES_PARAM = "9,10,11";

/**
 * Pure: one Withings measure group -> one blood pressure entry, or null when it is not one. A group
 * counts only when it carries both systolic and diastolic; a lone pulse (a scale, say) is not a
 * blood pressure reading. A measure is `value * 10^unit`.
 */
export function shapeBloodPressureGroup(group: WithingsMeasureGroup): ShapedBloodPressure | null {
  if (group.grpid == null || !Number.isFinite(group.date) || group.date <= 0) return null;
  if (group.attrib != null && UNATTRIBUTED_ATTRIBS.has(group.attrib)) return null;
  const byMetric = new Map<BloodPressureMetric, { value: number; unit: "mmHg" | "bpm" }>();
  for (const m of group.measures ?? []) {
    const spec = MEASURE_TYPE_TO_METRIC[m.type];
    if (!spec || !Number.isFinite(m.value) || !Number.isFinite(m.unit)) continue;
    const value = Math.round(m.value * 10 ** m.unit * 100) / 100;
    if (!(value > 0)) continue;
    byMetric.set(spec.metric, { value, unit: spec.unit });
  }
  if (!byMetric.has("blood_pressure_systolic") || !byMetric.has("blood_pressure_diastolic")) return null;
  const order: BloodPressureMetric[] = ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"];
  return {
    grpid: String(group.grpid),
    measuredAt: new Date(group.date * 1000),
    readings: order.flatMap((metric) => {
      const hit = byMetric.get(metric);
      return hit ? [{ metric, value: hit.value, unit: hit.unit }] : [];
    }),
  };
}

type MeasurePage = { groups: WithingsMeasureGroup[]; more: boolean; offset: number; updatetime: number | null };

async function getMeasurePage(
  accessToken: string,
  range: { startdate: number; enddate: number } | { lastupdate: number },
  offset: number,
  fetchImpl: FetchLike,
): Promise<MeasurePage> {
  const form: Record<string, string> = {
    action: "getmeas",
    meastypes: MEASURE_TYPES_PARAM,
    // Category 1 is real measurements, not goals.
    category: "1",
    ...Object.fromEntries(Object.entries(range).map(([k, v]) => [k, String(v)])),
  };
  if (offset > 0) form.offset = String(offset);
  const body = await callWithings(MEASURE_URL, form, accessToken, fetchImpl);
  return {
    groups: Array.isArray(body.measuregrps) ? (body.measuregrps as WithingsMeasureGroup[]) : [],
    more: body.more === 1 || body.more === true,
    offset: typeof body.offset === "number" ? body.offset : 0,
    updatetime: typeof body.updatetime === "number" ? body.updatetime : null,
  };
}

// --- Import -----------------------------------------------------------------------------------

type LinkRow = typeof healthWithingsLinks.$inferSelect;

type ImportOutcome = "imported" | "seen" | "ignored";

const EVENT_TITLE = "Blood pressure";
const EVENT_NOTES = "Imported from Withings";

function requireKey(env: Pick<Env, "ENCRYPTION_KEY">): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required for Withings links");
  return env.ENCRYPTION_KEY;
}

/**
 * Runs `fn` in a short transaction scoped to one household. Everything here that touches the database
 * goes through one of these, and nothing waits on Withings while holding one: a worker that dies
 * mid-sync then loses at most the page it was importing, never a token it already took from Withings.
 */
export type InHousehold = <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;

/** Withings group id -> the entry it made (null once that entry was deleted). */
type SeenGroups = Map<string, string | null>;

/**
 * Which of a page's groups were imported before. Keyed to the person and their Withings user, not to
 * the link, so it survives an unlink: reconnecting the same account (the fix for a revoked link) must
 * not import the same readings a second time, nor bring back ones that were deleted.
 */
async function loadSeenGroups(
  db: Database,
  link: Pick<LinkRow, "memberId" | "withingsUserId">,
  groups: WithingsMeasureGroup[],
): Promise<SeenGroups> {
  const ids = groups.map((g) => (g.grpid == null ? "" : String(g.grpid))).filter(Boolean);
  const seen: SeenGroups = new Map();
  if (ids.length === 0) return seen;
  const rows = await db
    .select({ grpid: healthWithingsMeasureGroups.grpid, eventId: healthWithingsMeasureGroups.eventId })
    .from(healthWithingsMeasureGroups)
    .where(
      and(
        eq(healthWithingsMeasureGroups.memberId, link.memberId),
        eq(healthWithingsMeasureGroups.withingsUserId, link.withingsUserId),
        inArray(healthWithingsMeasureGroups.grpid, ids),
      ),
    );
  for (const row of rows) seen.set(row.grpid, row.eventId);
  return seen;
}

/**
 * One group -> one `vitals` entry, exactly once. The `(member, Withings user, grpid)` row is both the
 * dedupe and, once its entry is deleted, a tombstone (event_id goes null) that keeps a backfill from
 * re-creating it. Groups that are not blood pressure, or that Withings could not attribute, leave no
 * row, so they are looked at again if they come back changed.
 */
async function importGroup(
  db: Database,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: Pick<LinkRow, "householdId" | "memberId" | "withingsUserId" | "linkedByUserId">,
  group: WithingsMeasureGroup,
  seen: SeenGroups,
): Promise<ImportOutcome> {
  const grpid = group.grpid == null ? "" : String(group.grpid);
  if (!grpid) return "ignored";
  if (seen.has(grpid)) return "seen";

  const shaped = shapeBloodPressureGroup(group);
  if (!shaped) return "ignored";

  const key = requireKey(env);
  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(healthEvents)
      .values({
        householdId: link.householdId,
        memberId: link.memberId,
        type: "vitals",
        title: encryptSensitive(EVENT_TITLE, key),
        notes: encryptSensitive(EVENT_NOTES, key),
        startedAt: shaped.measuredAt,
        visibility: "private",
        createdByUserId: link.linkedByUserId,
      })
      .returning({ id: healthEvents.id });
    await tx.insert(healthVitalsReadings).values(
      shaped.readings.map((r) => ({
        eventId: event!.id,
        metric: r.metric,
        value: encryptSensitive(String(r.value), key),
        unit: r.unit,
      })),
    );
    await tx
      .insert(healthWithingsMeasureGroups)
      .values({
        householdId: link.householdId,
        memberId: link.memberId,
        withingsUserId: link.withingsUserId,
        grpid,
        eventId: event!.id,
      })
      .onConflictDoNothing();
  });
  seen.set(grpid, null);
  return "imported";
}

// --- Sync -------------------------------------------------------------------------------------

function accessTokenIsFresh(link: Pick<LinkRow, "tokenExpiresAt">, now: Date): boolean {
  return link.tokenExpiresAt.getTime() - now.getTime() > TOKEN_REFRESH_SKEW_MS;
}

/**
 * A usable access token, refreshing first if it is about to lapse. Withings retires the old refresh
 * token the moment it issues the new one, so the new pair is written and committed before anything else
 * happens, in its own short transaction.
 */
async function freshAccessToken(
  inHousehold: InHousehold,
  env: Env,
  link: LinkRow,
  now: Date,
  fetchImpl: FetchLike,
): Promise<string> {
  if (accessTokenIsFresh(link, now)) return decryptWithingsSecret(link.accessTokenEncrypted, env);
  const tokens = await withingsRefresh(env, decryptWithingsSecret(link.refreshTokenEncrypted, env), fetchImpl);
  await inHousehold((tx) =>
    tx
      .update(healthWithingsLinks)
      .set({
        accessTokenEncrypted: encryptWithingsSecret(tokens.accessToken, env),
        refreshTokenEncrypted: encryptWithingsSecret(tokens.refreshToken, env),
        tokenExpiresAt: new Date(now.getTime() + tokens.expiresInSec * 1000),
        updatedAt: now,
      })
      .where(eq(healthWithingsLinks.id, link.id)),
  );
  return tokens.accessToken;
}

/**
 * An access token that works right now, for a link that is about to be deleted (unlink): refreshes if
 * needed but writes nothing, since the row is going away. Without this, unlink would try to cancel the
 * webhook with a token that has usually lapsed (they last about three hours).
 */
export async function withingsCurrentAccessToken(
  env: Env,
  link: Pick<LinkRow, "accessTokenEncrypted" | "refreshTokenEncrypted" | "tokenExpiresAt">,
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  if (accessTokenIsFresh(link, now)) return decryptWithingsSecret(link.accessTokenEncrypted, env);
  const tokens = await withingsRefresh(env, decryptWithingsSecret(link.refreshTokenEncrypted, env), fetchImpl);
  return tokens.accessToken;
}

export function withingsBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

/**
 * Pull whatever is new for one link and import it. The first run walks the history window
 * (`backfillFrom` .. now); later runs ask only for groups changed since the `lastUpdate` watermark.
 * The watermark is the `updatetime` of the first page, so a reading that lands while a long backfill
 * is still paging is picked up by the next incremental pull rather than lost.
 *
 * Each page is fetched with no transaction open and imported in one short one, so a failure keeps
 * the pages already imported; the watermark only moves when every page succeeded.
 */
export async function syncWithingsLink(
  inHousehold: InHousehold,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: LinkRow,
  accessToken: string,
  now: Date,
  fetchImpl: FetchLike = fetch,
): Promise<{ imported: number; backfilled: boolean; lastUpdate: number }> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const backfilling = link.backfillDoneAt == null || link.lastUpdate == null;
  const range = backfilling
    ? { startdate: Math.floor(link.backfillFrom.getTime() / 1000), enddate: nowSec }
    : { lastupdate: link.lastUpdate! };

  let imported = 0;
  let watermark: number | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await getMeasurePage(accessToken, range, offset, fetchImpl);
    watermark ??= result.updatetime;
    imported += await inHousehold(async (tx) => {
      const seen = await loadSeenGroups(tx, link, result.groups);
      let n = 0;
      for (const group of result.groups) {
        if ((await importGroup(tx, env, link, group, seen)) === "imported") n += 1;
      }
      return n;
    });
    if (!result.more) {
      return { imported, backfilled: backfilling, lastUpdate: watermark ?? nowSec };
    }
    offset = result.offset;
  }
  // Never silently stop halfway: the watermark stays put, so the next run starts over (and the
  // `(member, Withings user, grpid)` dedupe makes that cheap).
  throw new WithingsError("transient", "Withings history is larger than one sync can page through");
}

/**
 * Sync one link. `db` is the base database, not a transaction: the lease, the token refresh, each
 * page and the outcome are each their own short household-scoped transaction, and Withings is only
 * ever called between them. The lease (`next_attempt_at`) stops a second tick or worker from syncing
 * the same link at once. A failed pull is recorded on the link and returned as `failed`; only a
 * database failure while recording it throws.
 */
export async function processWithingsLink(
  db: Database,
  env: Env,
  target: { householdId: string; linkId: string },
  now: Date,
  fetchImpl: FetchLike = fetch,
): Promise<"synced" | "skipped" | "failed"> {
  const inHousehold: InHousehold = (fn) => withHouseholdContext(db, target.householdId, fn);

  const [link] = await inHousehold((tx) =>
    tx
      .update(healthWithingsLinks)
      .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
      .where(
        and(
          eq(healthWithingsLinks.id, target.linkId),
          eq(healthWithingsLinks.status, "active"),
          or(isNull(healthWithingsLinks.nextAttemptAt), lte(healthWithingsLinks.nextAttemptAt, now)),
        ),
      )
      .returning(),
  );
  if (!link) return "skipped";

  try {
    const accessToken = await freshAccessToken(inHousehold, env, link, now, fetchImpl);
    const result = await syncWithingsLink(inHousehold, env, link, accessToken, now, fetchImpl);
    await inHousehold(async (tx) => {
      await tx
        .update(healthWithingsLinks)
        .set({
          lastSyncedAt: now,
          lastError: null,
          attempts: 0,
          nextAttemptAt: null,
          lastUpdate: result.lastUpdate,
          backfillDoneAt: link.backfillDoneAt ?? now,
          updatedAt: now,
        })
        .where(eq(healthWithingsLinks.id, link.id));
      // Clear the request only if nothing re-flagged the link while we were pulling.
      await tx
        .update(healthWithingsLinks)
        .set({ syncRequestedAt: null })
        .where(and(eq(healthWithingsLinks.id, link.id), lte(healthWithingsLinks.syncRequestedAt, now)));
    });
    return "synced";
  } catch (e) {
    const err = e instanceof WithingsError ? e : new WithingsError("transient", "sync failed");
    if (!(e instanceof WithingsError)) {
      console.error("[withings] unexpected sync error", e instanceof Error ? e.message : e);
    }
    const base = { lastError: err.opts.status ? `${err.code}: ${err.opts.status}` : err.code, updatedAt: now };
    const table = healthWithingsLinks;
    const record = (set: Partial<typeof healthWithingsLinks.$inferInsert>) =>
      inHousehold((tx) => tx.update(table).set({ ...base, ...set }).where(eq(table.id, link.id)));
    switch (err.code) {
      case "token_invalid":
        await record({ status: "revoked", syncRequestedAt: null, nextAttemptAt: null });
        break;
      case "rate_limited":
        await record({ nextAttemptAt: new Date(now.getTime() + RATE_LIMIT_BACKOFF_MS) });
        break;
      case "not_configured":
        await record({ nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_BACKOFF_MS) });
        break;
      default: {
        const attempts = link.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await record({ attempts, status: "error", syncRequestedAt: null, nextAttemptAt: null });
        } else {
          await record({ attempts, nextAttemptAt: new Date(now.getTime() + withingsBackoffMs(attempts)) });
        }
      }
    }
    return "failed";
  }
}

/** Links that want a pull now: flagged by a webhook or "Sync now", never synced, or past the safety net. */
function dueWhere(now: Date) {
  return and(
    eq(healthWithingsLinks.status, "active"),
    or(
      and(isNotNull(healthWithingsLinks.syncRequestedAt), lte(healthWithingsLinks.syncRequestedAt, now)),
      isNull(healthWithingsLinks.lastSyncedAt),
      lt(healthWithingsLinks.lastSyncedAt, new Date(now.getTime() - WITHINGS_SAFETY_NET_MS)),
    ),
    or(isNull(healthWithingsLinks.nextAttemptAt), lte(healthWithingsLinks.nextAttemptAt, now)),
  );
}

/** The tick (cross-tenant, read only): which households have a link to pull. One job each. */
export async function fanOutWithingsSync(
  db: Database,
  env: Pick<Env, "WITHINGS_CLIENT_ID" | "WITHINGS_CLIENT_SECRET">,
  deps: { enqueue: EnqueueHouseholdScan; now?: Date },
): Promise<number> {
  if (!withingsCredentials(env)) return 0;
  const now = deps.now ?? new Date();
  const rows = await db
    .selectDistinct({ id: healthWithingsLinks.householdId })
    .from(healthWithingsLinks)
    .where(dueWhere(now));
  return enqueueForHouseholds("withings.sync.household", rows.map((r) => r.id), { ...deps, now });
}

/**
 * The household job: sync that household's due links. `db` is the base database; see
 * `processWithingsLink` for why this job does not run inside one transaction.
 */
export async function syncWithingsHousehold(
  db: Database,
  env: Env,
  input: { householdId: string; now?: Date; fetchImpl?: FetchLike },
): Promise<{ synced: number; skipped: number; failed: number }> {
  const tally = { synced: 0, skipped: 0, failed: 0 };
  if (!withingsCredentials(env)) return tally;
  const now = input.now ?? new Date();
  const due = await withHouseholdContext(db, input.householdId, (tx) =>
    tx
      .select({ id: healthWithingsLinks.id })
      .from(healthWithingsLinks)
      .where(and(eq(healthWithingsLinks.householdId, input.householdId), dueWhere(now)))
      .limit(HOUSEHOLD_BATCH),
  );
  for (const link of due) {
    const target = { householdId: input.householdId, linkId: link.id };
    tally[await processWithingsLink(db, env, target, now, input.fetchImpl ?? fetch)] += 1;
  }
  return tally;
}

/** Flag a member's active link for a pull (webhook, "Sync now"). Never throws. */
export async function markWithingsSyncNeeded(db: Database, linkId: string, now: Date = new Date()): Promise<void> {
  try {
    await db
      .update(healthWithingsLinks)
      .set({ syncRequestedAt: now })
      .where(and(eq(healthWithingsLinks.id, linkId), eq(healthWithingsLinks.status, "active")));
  } catch (e) {
    console.error("[withings] could not flag sync", e instanceof Error ? e.message : e);
  }
}
