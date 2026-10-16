import { withingsCredentials, type Env } from "@domi-ops/config";
import { decryptSensitive, encryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthExerciseDetails,
  healthVitalsReadings,
  healthWithingsLinks,
  healthWithingsDailyActivity,
  healthWithingsMeasureGroups,
  healthWithingsSleep,
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

/**
 * `user.metrics` covers every `getmeas` reading (blood pressure, SpO2, temperature, heart rate);
 * `user.activity` is what `getworkouts` needs. A link made before the second scope existed keeps
 * working without workouts until the person reconnects.
 */
export const WITHINGS_SCOPE = "user.metrics,user.activity";
export const WITHINGS_ACTIVITY_SCOPE = "user.activity";

/** Whether the scope Withings granted this link includes workouts. */
export function withingsScopeAllowsWorkouts(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/[,\s]+/).includes(WITHINGS_ACTIVITY_SCOPE);
}
/** Notify category 4: blood pressure and heart rate. */
export const WITHINGS_APPLI_BLOOD_PRESSURE = 4;
/** Notify application for activity and workouts. */
export const WITHINGS_APPLI_ACTIVITY = 16;
/** Notify application for sleep. */
export const WITHINGS_APPLI_SLEEP = 44;

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

/**
 * Ask Withings to POST to `callbackUrl` when this user has new blood pressure data, and new workouts
 * too when the link may read them. The workout subscription is best effort: the six hour safety net
 * picks up whatever it misses.
 */
export async function withingsSubscribe(
  accessToken: string,
  callbackUrl: string,
  fetchImpl: FetchLike = fetch,
  opts: { workouts?: boolean; resubscribe?: boolean } = {},
): Promise<void> {
  const call = (appli: number) =>
    callWithings(NOTIFY_URL, { action: "subscribe", callbackurl: callbackUrl, appli: String(appli) }, accessToken, fetchImpl);
  // Reconnect subscribes again to a URL Withings may already hold. Whatever it answers to that must not
  // stop the workout subscription, which is the one a reconnect usually exists to add.
  if (opts.resubscribe) await call(WITHINGS_APPLI_BLOOD_PRESSURE).catch(() => undefined);
  else await call(WITHINGS_APPLI_BLOOD_PRESSURE);
  if (opts.workouts) {
    await call(WITHINGS_APPLI_ACTIVITY).catch(() => undefined);
    await call(WITHINGS_APPLI_SLEEP).catch(() => undefined);
  }
}

export async function withingsUnsubscribe(accessToken: string, callbackUrl: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const call = (appli: number) =>
    callWithings(NOTIFY_URL, { action: "revoke", callbackurl: callbackUrl, appli: String(appli) }, accessToken, fetchImpl);
  await call(WITHINGS_APPLI_BLOOD_PRESSURE);
  await call(WITHINGS_APPLI_ACTIVITY).catch(() => undefined);
  await call(WITHINGS_APPLI_SLEEP).catch(() => undefined);
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

export type VitalsMetric = "blood_pressure_systolic" | "blood_pressure_diastolic" | "heart_rate" | "blood_oxygen" | "temperature";
export type ShapedVitals = {
  grpid: string;
  measuredAt: Date;
  /** "Blood pressure" when the group has one, else "Vitals". */
  title: string;
  readings: Array<{ metric: VitalsMetric; value: number; unit: "mmHg" | "bpm" | "%" | "°F" }>;
};

type MeasureSpec = { metric: VitalsMetric; unit: ShapedVitals["readings"][number]["unit"]; convert?: (v: number) => number };

/**
 * Withings measure types: 9 diastolic, 10 systolic, 11 heart pulse, 54 SpO2 (%), 71 body temperature
 * (Celsius, kept in the app's default Fahrenheit). Skin temperature (73) is deliberately left out:
 * it is a different quantity and would sit beside real fever readings as a number that means less.
 */
const MEASURE_TYPE_TO_METRIC: Record<number, MeasureSpec> = {
  9: { metric: "blood_pressure_diastolic", unit: "mmHg" },
  10: { metric: "blood_pressure_systolic", unit: "mmHg" },
  11: { metric: "heart_rate", unit: "bpm" },
  54: { metric: "blood_oxygen", unit: "%" },
  71: { metric: "temperature", unit: "°F", convert: (c) => (c * 9) / 5 + 32 },
};
const MEASURE_TYPES_PARAM = Object.keys(MEASURE_TYPE_TO_METRIC).join(",");
const VITALS_ORDER: VitalsMetric[] = [
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "heart_rate",
  "blood_oxygen",
  "temperature",
];

/**
 * Pure: one Withings measure group -> one vitals entry, or null when it holds nothing we keep. Blood
 * pressure counts only with both systolic and diastolic; a half pair is dropped and the rest of the
 * group (a pulse, say) is still kept. A measure is `value * 10^unit`.
 */
export function shapeVitalsGroup(group: WithingsMeasureGroup): ShapedVitals | null {
  if (group.grpid == null || !Number.isFinite(group.date) || group.date <= 0) return null;
  if (group.attrib != null && UNATTRIBUTED_ATTRIBS.has(group.attrib)) return null;
  const byMetric = new Map<VitalsMetric, { value: number; unit: MeasureSpec["unit"] }>();
  for (const m of group.measures ?? []) {
    const spec = MEASURE_TYPE_TO_METRIC[m.type];
    if (!spec || !Number.isFinite(m.value) || !Number.isFinite(m.unit)) continue;
    const raw = m.value * 10 ** m.unit;
    const value = Math.round((spec.convert ? spec.convert(raw) : raw) * 100) / 100;
    if (!(value > 0)) continue;
    byMetric.set(spec.metric, { value, unit: spec.unit });
  }
  const hasBp = byMetric.has("blood_pressure_systolic") && byMetric.has("blood_pressure_diastolic");
  if (!hasBp) {
    byMetric.delete("blood_pressure_systolic");
    byMetric.delete("blood_pressure_diastolic");
  }
  const readings = VITALS_ORDER.flatMap((metric) => {
    const hit = byMetric.get(metric);
    return hit ? [{ metric, value: hit.value, unit: hit.unit }] : [];
  });
  if (readings.length === 0) return null;
  return {
    grpid: String(group.grpid),
    measuredAt: new Date(group.date * 1000),
    title: hasBp ? "Blood pressure" : "Vitals",
    readings,
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
 * re-creating it. Groups with nothing we keep, or that Withings could not attribute, leave no
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

  const shaped = shapeVitalsGroup(group);
  if (!shaped) return "ignored";

  const key = requireKey(env);
  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(healthEvents)
      .values({
        householdId: link.householdId,
        memberId: link.memberId,
        type: "vitals",
        title: encryptSensitive(shaped.title, key),
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

// --- Workouts ---------------------------------------------------------------------------------

const WORKOUTS_URL = "https://wbsapi.withings.net/v2/measure";
/**
 * Workouts keep their own watermark (`link.workoutsLastUpdate`, the greatest workout `modified` seen),
 * because Withings does not say that its `getmeas` `updatetime` and a workout's `modified` are one clock.
 * Until a workout has been seen there is nothing to resume from, so the pull falls back to the measurement
 * watermark minus a day. That costs nothing, since `workout:<id>` dedupes.
 */
const WORKOUT_OVERLAP_SEC = 24 * 60 * 60;
const WORKOUT_FIELDS = "calories,distance,steps,hr_average";
/** Keeps a workout's id apart from a measure group's in the shared dedupe table. */
const workoutKey = (id: string | number) => `workout:${id}`;

export type WithingsWorkout = {
  id: number | string;
  /** Withings workout category (1 walk, 2 run, 6 bicycling, ...). */
  category?: number;
  startdate: number;
  enddate: number;
  /** When Withings last changed this workout (unix seconds). The workout watermark follows it. */
  modified?: number;
  data?: { calories?: number; distance?: number; steps?: number; hr_average?: number };
};

/** From Withings' published category list; anything else is just a "Workout". */
const WORKOUT_NAMES: Record<number, string> = {
  1: "Walking",
  2: "Running",
  3: "Hiking",
  4: "Skating",
  6: "Cycling",
  7: "Swimming",
  8: "Surfing",
  12: "Tennis",
  13: "Table tennis",
  14: "Squash",
  15: "Badminton",
  16: "Weight training",
  17: "Calisthenics",
  18: "Elliptical",
  19: "Pilates",
  20: "Basketball",
  21: "Soccer",
  22: "Football",
  27: "Golf",
  28: "Yoga",
  29: "Dancing",
  30: "Boxing",
  33: "Martial arts",
  34: "Skiing",
  35: "Snowboarding",
  187: "Rowing",
  188: "Zumba",
  195: "Climbing",
  306: "Walking (indoor)",
  307: "Running (indoor)",
  308: "Cycling (indoor)",
};

export type ShapedWorkout = {
  key: string;
  id: string;
  activity: string;
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
  distanceKm: number | null;
  calories: number | null;
};

/** Pure: one Withings workout -> what an exercise entry needs, or null when it has no usable span. */
export function shapeWorkout(workout: WithingsWorkout): ShapedWorkout | null {
  if (workout.id == null || !Number.isFinite(workout.startdate) || !Number.isFinite(workout.enddate)) return null;
  if (workout.startdate <= 0 || workout.enddate <= workout.startdate) return null;
  const positive = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
  const distanceM = positive(workout.data?.distance);
  const calories = positive(workout.data?.calories);
  return {
    key: workoutKey(workout.id),
    id: String(workout.id),
    activity: (workout.category != null && WORKOUT_NAMES[workout.category]) || "Workout",
    startedAt: new Date(workout.startdate * 1000),
    endedAt: new Date(workout.enddate * 1000),
    durationMinutes: Math.max(1, Math.round((workout.enddate - workout.startdate) / 60)),
    distanceKm: distanceM == null ? null : Math.round(distanceM / 10) / 100,
    calories: calories == null ? null : Math.round(calories),
  };
}

type WorkoutPage = { workouts: WithingsWorkout[]; more: boolean; offset: number };

/** `YYYY-MM-DD` of an instant in UTC. Callers pad a day either side, since Withings reads these in the user's own zone. */
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function getWorkoutsPage(
  accessToken: string,
  range: { startdateymd: string; enddateymd: string } | { lastupdate: number },
  offset: number,
  fetchImpl: FetchLike,
): Promise<WorkoutPage> {
  const form: Record<string, string> = {
    action: "getworkouts",
    data_fields: WORKOUT_FIELDS,
    ...Object.fromEntries(Object.entries(range).map(([k, v]) => [k, String(v)])),
  };
  if (offset > 0) form.offset = String(offset);
  const body = await callWithings(WORKOUTS_URL, form, accessToken, fetchImpl);
  return {
    workouts: Array.isArray(body.series) ? (body.series as WithingsWorkout[]) : [],
    more: body.more === 1 || body.more === true,
    offset: typeof body.offset === "number" ? body.offset : 0,
  };
}

/** One workout -> one `exercise` entry, exactly once (same dedupe and tombstone as a measure group). */
async function importWorkout(
  db: Database,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: Pick<LinkRow, "householdId" | "memberId" | "withingsUserId" | "linkedByUserId">,
  workout: WithingsWorkout,
  seen: SeenGroups,
): Promise<ImportOutcome> {
  const shaped = shapeWorkout(workout);
  if (!shaped) return "ignored";
  if (seen.has(shaped.key)) return "seen";

  const key = requireKey(env);
  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(healthEvents)
      .values({
        householdId: link.householdId,
        memberId: link.memberId,
        type: "exercise",
        title: encryptSensitive(shaped.activity, key),
        notes: encryptSensitive(EVENT_NOTES, key),
        startedAt: shaped.startedAt,
        endedAt: shaped.endedAt,
        visibility: "private",
        createdByUserId: link.linkedByUserId,
      })
      .returning({ id: healthEvents.id });
    await tx.insert(healthExerciseDetails).values({
      eventId: event!.id,
      activity: encryptSensitive(shaped.activity, key),
      durationMinutes: encryptSensitive(String(shaped.durationMinutes), key),
      distance: shaped.distanceKm == null ? null : encryptSensitive(String(shaped.distanceKm), key),
      distanceUnit: shaped.distanceKm == null ? null : "km",
      caloriesEstimated: shaped.calories == null ? null : encryptSensitive(String(shaped.calories), key),
      externalSource: "withings",
      externalId: shaped.id,
    });
    await tx
      .insert(healthWithingsMeasureGroups)
      .values({
        householdId: link.householdId,
        memberId: link.memberId,
        withingsUserId: link.withingsUserId,
        grpid: shaped.key,
        eventId: event!.id,
      })
      .onConflictDoNothing();
  });
  seen.set(shaped.key, null);
  return "imported";
}

async function syncWorkouts(
  inHousehold: InHousehold,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: LinkRow,
  accessToken: string,
  now: Date,
  backfilling: boolean,
  fetchImpl: FetchLike,
): Promise<{ imported: number; lastUpdate: number | null }> {
  // Resuming from the watermark minus one second: `lastupdate` is exclusive and several workouts can
  // share a second; the dedupe key makes the re-read free.
  const range = backfilling
    ? {
        startdateymd: ymd(new Date(link.backfillFrom.getTime() - 86_400_000)),
        enddateymd: ymd(new Date(now.getTime() + 86_400_000)),
      }
    : {
        lastupdate: Math.max(
          0,
          link.workoutsLastUpdate != null ? link.workoutsLastUpdate - 1 : link.lastUpdate! - WORKOUT_OVERLAP_SEC,
        ),
      };
  let imported = 0;
  let newest = link.workoutsLastUpdate;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await getWorkoutsPage(accessToken, range, offset, fetchImpl);
    for (const w of result.workouts) {
      if (Number.isFinite(w.modified) && (newest == null || w.modified! > newest)) newest = w.modified!;
    }
    imported += await inHousehold(async (tx) => {
      const ids = result.workouts.map((w) => ({ grpid: workoutKey(w.id) }) as WithingsMeasureGroup);
      const seen = await loadSeenGroups(tx, link, ids);
      let n = 0;
      for (const workout of result.workouts) {
        if ((await importWorkout(tx, env, link, workout, seen)) === "imported") n += 1;
      }
      return n;
    });
    if (!result.more) return { imported, lastUpdate: newest };
    offset = result.offset;
  }
  throw new WithingsError("transient", "Withings workout history is larger than one sync can page through");
}

// --- Daily activity ---------------------------------------------------------------------------

/**
 * `getactivity` rows (WHO-465), one per date and device. Request fields and units are from Withings' published
 * OpenAPI spec: distance in meters, `active` in seconds (intense plus moderate), `calories` active kcal,
 * `totalcalories` active plus resting kcal, `modified` unix seconds. Not yet seen against a real ScanWatch.
 */
export type WithingsActivity = {
  /** `YYYY-MM-DD`, in the user's own zone (`timezone`). */
  date: string;
  timezone?: string;
  deviceid?: string | null;
  hash_deviceid?: string | null;
  is_tracker?: boolean;
  modified?: number;
  steps?: number;
  distance?: number;
  active?: number;
  calories?: number;
  totalcalories?: number;
};

const ACTIVITY_FIELDS = "steps,distance,active,calories,totalcalories";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ShapedActivity = {
  date: string;
  deviceKey: string;
  isTracker: boolean;
  steps: number | null;
  distanceM: number | null;
  activeMinutes: number | null;
  caloriesActive: number | null;
  caloriesTotal: number | null;
  modified: number | null;
};

/** Pure: one Withings activity row -> what a daily activity row needs, or null when it carries nothing usable. */
export function shapeActivity(row: WithingsActivity): ShapedActivity | null {
  if (typeof row.date !== "string" || !DATE_RE.test(row.date)) return null;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
  const steps = num(row.steps);
  const distanceM = num(row.distance);
  const activeSec = num(row.active);
  const caloriesActive = num(row.calories);
  const caloriesTotal = num(row.totalcalories);
  if (steps == null && distanceM == null && activeSec == null && caloriesActive == null && caloriesTotal == null) return null;
  return {
    date: row.date,
    deviceKey: row.hash_deviceid || row.deviceid || "",
    isTracker: row.is_tracker === true,
    steps: steps == null ? null : Math.round(steps),
    distanceM: distanceM == null ? null : Math.round(distanceM),
    activeMinutes: activeSec == null ? null : Math.round(activeSec / 60),
    caloriesActive: caloriesActive == null ? null : Math.round(caloriesActive),
    caloriesTotal: caloriesTotal == null ? null : Math.round(caloriesTotal),
    modified: typeof row.modified === "number" && Number.isFinite(row.modified) ? row.modified : null,
  };
}

type ActivityPage = { activities: WithingsActivity[]; more: boolean; offset: number };

async function getActivityPage(
  accessToken: string,
  range: { startdateymd: string; enddateymd: string } | { lastupdate: number },
  offset: number,
  fetchImpl: FetchLike,
): Promise<ActivityPage> {
  const form: Record<string, string> = {
    action: "getactivity",
    data_fields: ACTIVITY_FIELDS,
    ...Object.fromEntries(Object.entries(range).map(([k, v]) => [k, String(v)])),
  };
  if (offset > 0) form.offset = String(offset);
  const body = await callWithings(WORKOUTS_URL, form, accessToken, fetchImpl);
  return {
    activities: Array.isArray(body.activities) ? (body.activities as WithingsActivity[]) : [],
    more: body.more === 1 || body.more === true,
    offset: typeof body.offset === "number" ? body.offset : 0,
  };
}

/**
 * Pull daily activity and keep each (date, device) row current. A day's numbers change until it ends, so
 * rows are updated in place rather than imported once. Returns the greatest `modified` seen, which becomes
 * the watermark; with nothing seen it stays where it was.
 */
async function syncDailyActivity(
  inHousehold: InHousehold,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: LinkRow,
  accessToken: string,
  now: Date,
  backfilling: boolean,
  fetchImpl: FetchLike,
): Promise<{ lastUpdate: number | null }> {
  const key = requireKey(env);
  const enc = (n: number | null) => (n == null ? null : encryptSensitive(String(n), key));
  const range = backfilling
    ? {
        startdateymd: ymd(new Date(link.backfillFrom.getTime() - 86_400_000)),
        enddateymd: ymd(new Date(now.getTime() + 86_400_000)),
      }
    : {
        // Exclusive on Withings' side, and several rows can share a second; re-reading one second is free.
        lastupdate: Math.max(
          0,
          link.activityLastUpdate != null ? link.activityLastUpdate - 1 : link.lastUpdate! - WORKOUT_OVERLAP_SEC,
        ),
      };
  let newest = link.activityLastUpdate;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await getActivityPage(accessToken, range, offset, fetchImpl);
    const shaped = result.activities.map(shapeActivity).filter((s): s is ShapedActivity => s != null);
    for (const s of shaped) {
      if (s.modified != null && (newest == null || s.modified > newest)) newest = s.modified;
    }
    if (shaped.length > 0) {
      await inHousehold(async (tx) => {
        for (const s of shaped) {
          const values = {
            householdId: link.householdId,
            memberId: link.memberId,
            withingsUserId: link.withingsUserId,
            date: s.date,
            deviceKey: s.deviceKey,
            isTracker: s.isTracker,
            steps: enc(s.steps),
            distanceM: enc(s.distanceM),
            activeMinutes: enc(s.activeMinutes),
            caloriesActive: enc(s.caloriesActive),
            caloriesTotal: enc(s.caloriesTotal),
            sourceModified: s.modified,
            updatedAt: now,
          };
          await tx
            .insert(healthWithingsDailyActivity)
            .values(values)
            .onConflictDoUpdate({
              target: [
                healthWithingsDailyActivity.memberId,
                healthWithingsDailyActivity.withingsUserId,
                healthWithingsDailyActivity.date,
                healthWithingsDailyActivity.deviceKey,
              ],
              set: {
                isTracker: values.isTracker,
                steps: values.steps,
                distanceM: values.distanceM,
                activeMinutes: values.activeMinutes,
                caloriesActive: values.caloriesActive,
                caloriesTotal: values.caloriesTotal,
                sourceModified: values.sourceModified,
                updatedAt: now,
              },
            });
        }
      });
    }
    if (!result.more) return { lastUpdate: newest };
    offset = result.offset;
  }
  throw new WithingsError("transient", "Withings activity history is larger than one sync can page through");
}

// --- Sleep ------------------------------------------------------------------------------------

const SLEEP_URL = "https://wbsapi.withings.net/v2/sleep";
const SLEEP_FIELDS =
  "total_timeinbed,total_sleep_time,asleepduration,lightsleepduration,remsleepduration,deepsleepduration,wakeupduration,wakeupcount,sleep_score";
/** Withings documents a `getsummary` call as covering at most 7 days, so a date-range pull goes a week at a time. */
const SLEEP_WINDOW_DAYS = 7;
/** A year of nights is 53 calls; more would run into Withings' rate limit for little use. */
const SLEEP_MAX_BACKFILL_DAYS = 365;

/**
 * `getsummary` series (WHO-466). Field names and units are from Withings' published OpenAPI spec (durations in
 * seconds, `modified` unix seconds), not yet checked against a real ScanWatch.
 */
export type WithingsSleepSeries = {
  id: number | string;
  timezone?: string;
  startdate: number;
  enddate: number;
  /** `YYYY-MM-DD`: the night's date. */
  date: string;
  modified?: number;
  data?: {
    total_timeinbed?: number;
    total_sleep_time?: number;
    asleepduration?: number;
    lightsleepduration?: number;
    remsleepduration?: number;
    deepsleepduration?: number;
    wakeupduration?: number;
    wakeupcount?: number;
    sleep_score?: number;
  };
};

export type ShapedSleep = {
  sleepId: string;
  date: string;
  startedAt: Date;
  endedAt: Date;
  totalSleepMinutes: number | null;
  inBedMinutes: number | null;
  lightMinutes: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  awakeMinutes: number | null;
  wakeCount: number | null;
  sleepScore: number | null;
  modified: number | null;
};

/** Pure: one Withings sleep series -> what a sleep row needs, or null when it has no usable span or date. */
export function shapeSleep(series: WithingsSleepSeries): ShapedSleep | null {
  if (series.id == null || typeof series.date !== "string" || !DATE_RE.test(series.date)) return null;
  if (!Number.isFinite(series.startdate) || !Number.isFinite(series.enddate)) return null;
  if (series.startdate <= 0 || series.enddate <= series.startdate) return null;
  const d = series.data ?? {};
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
  const minutes = (sec: unknown) => {
    const n = num(sec);
    return n == null ? null : Math.round(n / 60);
  };
  // A night from an outside source has `asleepduration` and no stage split.
  const total = minutes(d.total_sleep_time) ?? minutes(d.asleepduration);
  const shaped: ShapedSleep = {
    sleepId: String(series.id),
    date: series.date,
    startedAt: new Date(series.startdate * 1000),
    endedAt: new Date(series.enddate * 1000),
    totalSleepMinutes: total,
    inBedMinutes: minutes(d.total_timeinbed),
    lightMinutes: minutes(d.lightsleepduration),
    deepMinutes: minutes(d.deepsleepduration),
    remMinutes: minutes(d.remsleepduration),
    awakeMinutes: minutes(d.wakeupduration),
    wakeCount: num(d.wakeupcount) == null ? null : Math.round(num(d.wakeupcount)!),
    sleepScore: num(d.sleep_score) == null ? null : Math.round(num(d.sleep_score)!),
    modified: typeof series.modified === "number" && Number.isFinite(series.modified) ? series.modified : null,
  };
  return total == null && shaped.inBedMinutes == null ? null : shaped;
}

type SleepPage = { series: WithingsSleepSeries[]; more: boolean; offset: number };

async function getSleepPage(
  accessToken: string,
  range: { startdateymd: string; enddateymd: string } | { lastupdate: number },
  offset: number,
  fetchImpl: FetchLike,
): Promise<SleepPage> {
  const form: Record<string, string> = {
    action: "getsummary",
    data_fields: SLEEP_FIELDS,
    ...Object.fromEntries(Object.entries(range).map(([k, v]) => [k, String(v)])),
  };
  if (offset > 0) form.offset = String(offset);
  const body = await callWithings(SLEEP_URL, form, accessToken, fetchImpl);
  return {
    series: Array.isArray(body.series) ? (body.series as WithingsSleepSeries[]) : [],
    more: body.more === 1 || body.more === true,
    offset: typeof body.offset === "number" ? body.offset : 0,
  };
}

/** Pull sleep and keep each night current. Returns the greatest `modified` seen, which becomes the watermark. */
async function syncSleep(
  inHousehold: InHousehold,
  env: Pick<Env, "ENCRYPTION_KEY">,
  link: LinkRow,
  accessToken: string,
  now: Date,
  backfilling: boolean,
  fetchImpl: FetchLike,
): Promise<{ lastUpdate: number | null }> {
  const key = requireKey(env);
  const enc = (n: number | null) => (n == null ? null : encryptSensitive(String(n), key));
  let newest = link.sleepLastUpdate;

  const ranges: Array<{ startdateymd: string; enddateymd: string } | { lastupdate: number }> = [];
  if (backfilling) {
    const dayMs = 86_400_000;
    const earliest = Math.max(link.backfillFrom.getTime() - dayMs, now.getTime() - SLEEP_MAX_BACKFILL_DAYS * dayMs);
    const end = now.getTime() + dayMs;
    for (let start = earliest; start < end; start += SLEEP_WINDOW_DAYS * dayMs) {
      ranges.push({ startdateymd: ymd(new Date(start)), enddateymd: ymd(new Date(Math.min(start + (SLEEP_WINDOW_DAYS - 1) * dayMs, end))) });
    }
  } else {
    ranges.push({
      lastupdate: Math.max(
        0,
        link.sleepLastUpdate != null ? link.sleepLastUpdate - 1 : link.lastUpdate! - WORKOUT_OVERLAP_SEC,
      ),
    });
  }

  for (const range of ranges) {
    let offset = 0;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) throw new WithingsError("transient", "Withings sleep history is larger than one sync can page through");
      const result = await getSleepPage(accessToken, range, offset, fetchImpl);
      const shaped = result.series.map(shapeSleep).filter((s): s is ShapedSleep => s != null);
      for (const s of shaped) {
        if (s.modified != null && (newest == null || s.modified > newest)) newest = s.modified;
      }
      if (shaped.length > 0) {
        await inHousehold(async (tx) => {
          for (const s of shaped) {
            const values = {
              householdId: link.householdId,
              memberId: link.memberId,
              withingsUserId: link.withingsUserId,
              sleepId: s.sleepId,
              date: s.date,
              startedAt: s.startedAt,
              endedAt: s.endedAt,
              totalSleepMinutes: enc(s.totalSleepMinutes),
              inBedMinutes: enc(s.inBedMinutes),
              lightMinutes: enc(s.lightMinutes),
              deepMinutes: enc(s.deepMinutes),
              remMinutes: enc(s.remMinutes),
              awakeMinutes: enc(s.awakeMinutes),
              wakeCount: enc(s.wakeCount),
              sleepScore: enc(s.sleepScore),
              sourceModified: s.modified,
              updatedAt: now,
            };
            await tx
              .insert(healthWithingsSleep)
              .values(values)
              .onConflictDoUpdate({
                target: [healthWithingsSleep.memberId, healthWithingsSleep.withingsUserId, healthWithingsSleep.sleepId],
                set: {
                  date: values.date,
                  startedAt: values.startedAt,
                  endedAt: values.endedAt,
                  totalSleepMinutes: values.totalSleepMinutes,
                  inBedMinutes: values.inBedMinutes,
                  lightMinutes: values.lightMinutes,
                  deepMinutes: values.deepMinutes,
                  remMinutes: values.remMinutes,
                  awakeMinutes: values.awakeMinutes,
                  wakeCount: values.wakeCount,
                  sleepScore: values.sleepScore,
                  sourceModified: values.sourceModified,
                  updatedAt: now,
                },
              });
          }
        });
      }
      if (!result.more) break;
      offset = result.offset;
    }
  }
  return { lastUpdate: newest };
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
): Promise<{
  imported: number;
  backfilled: boolean;
  lastUpdate: number;
  workoutsLastUpdate: number | null;
  activityLastUpdate: number | null;
  sleepLastUpdate: number | null;
}> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const backfilling = link.backfillDoneAt == null || link.lastUpdate == null;
  const range = backfilling
    ? { startdate: Math.floor(link.backfillFrom.getTime() / 1000), enddate: nowSec }
    : { lastupdate: link.lastUpdate! };

  let imported = 0;
  let workoutsLastUpdate = link.workoutsLastUpdate;
  let activityLastUpdate = link.activityLastUpdate;
  let sleepLastUpdate = link.sleepLastUpdate;
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
      // Workouts need the activity scope, which a link made before it existed does not have.
      if (withingsScopeAllowsWorkouts(link.scope)) {
        const workouts = await syncWorkouts(inHousehold, env, link, accessToken, now, backfilling, fetchImpl);
        imported += workouts.imported;
        workoutsLastUpdate = workouts.lastUpdate;
        // Daily activity is the same scope and never blocks blood pressure or workouts: a failure here is
        // logged and retried on the next pull, from the watermark that did not move.
        try {
          const activity = await syncDailyActivity(inHousehold, env, link, accessToken, now, backfilling, fetchImpl);
          activityLastUpdate = activity.lastUpdate;
        } catch (e) {
          if (e instanceof WithingsError && (e.code === "token_invalid" || e.code === "rate_limited" || e.code === "not_configured")) throw e;
          console.error("[withings] daily activity pull failed", e instanceof Error ? e.message : e);
        }
        // Same for sleep: its own pull, its own watermark, and no way to fail the rest.
        try {
          const sleep = await syncSleep(inHousehold, env, link, accessToken, now, backfilling, fetchImpl);
          sleepLastUpdate = sleep.lastUpdate;
        } catch (e) {
          if (e instanceof WithingsError && (e.code === "token_invalid" || e.code === "rate_limited" || e.code === "not_configured")) throw e;
          console.error("[withings] sleep pull failed", e instanceof Error ? e.message : e);
        }
      }
      return { imported, backfilled: backfilling, lastUpdate: watermark ?? nowSec, workoutsLastUpdate, activityLastUpdate, sleepLastUpdate };
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
          workoutsLastUpdate: result.workoutsLastUpdate,
          activityLastUpdate: result.activityLastUpdate,
          sleepLastUpdate: result.sleepLastUpdate,
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
