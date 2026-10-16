import { describe, expect, it } from "vitest";
import {
  WithingsError,
  encryptWithingsSecret,
  shapeVitalsGroup,
  shapeActivity,
  shapeWorkout,
  withingsScopeAllowsWorkouts,
  withingsUnsubscribe,
  withingsAuthorizeUrl,
  withingsBackoffMs,
  withingsCurrentAccessToken,
  withingsExchangeCode,
  withingsSubscribe,
} from "./withings-sync.js";

const creds = { WITHINGS_CLIENT_ID: "client-id", WITHINGS_CLIENT_SECRET: "client-secret" };

const group = (over: Record<string, unknown> = {}) => ({
  grpid: 4242,
  date: 1_791_000_000,
  measures: [
    { value: 128, type: 10, unit: 0 },
    { value: 82, type: 9, unit: 0 },
    { value: 64, type: 11, unit: 0 },
  ],
  ...over,
});

describe("shapeVitalsGroup", () => {
  it("maps systolic, diastolic and pulse, in that order, with the measured instant", () => {
    const shaped = shapeVitalsGroup(group());
    expect(shaped).toEqual({
      grpid: "4242",
      measuredAt: new Date(1_791_000_000 * 1000),
      title: "Blood pressure",
      readings: [
        { metric: "blood_pressure_systolic", value: 128, unit: "mmHg" },
        { metric: "blood_pressure_diastolic", value: 82, unit: "mmHg" },
        { metric: "heart_rate", value: 64, unit: "bpm" },
      ],
    });
  });

  it("applies the power-of-ten unit", () => {
    const shaped = shapeVitalsGroup(
      group({ measures: [{ value: 1285, type: 10, unit: -1 }, { value: 82, type: 9, unit: 0 }] }),
    );
    expect(shaped?.readings[0]).toEqual({ metric: "blood_pressure_systolic", value: 128.5, unit: "mmHg" });
  });

  it("keeps a reading without a pulse", () => {
    const shaped = shapeVitalsGroup(group({ measures: [{ value: 120, type: 10, unit: 0 }, { value: 80, type: 9, unit: 0 }] }));
    expect(shaped?.readings.map((r) => r.metric)).toEqual(["blood_pressure_systolic", "blood_pressure_diastolic"]);
  });

  it("drops half a blood pressure pair but keeps the rest of the group", () => {
    expect(shapeVitalsGroup(group({ measures: [{ value: 120, type: 10, unit: 0 }] }))).toBeNull();
    expect(shapeVitalsGroup(group({ measures: [] }))).toBeNull();
    const withPulse = shapeVitalsGroup(
      group({ measures: [{ value: 120, type: 10, unit: 0 }, { value: 64, type: 11, unit: 0 }] }),
    );
    expect(withPulse?.readings.map((r) => r.metric)).toEqual(["heart_rate"]);
    expect(withPulse?.title).toBe("Vitals");
  });

  it("keeps watch readings: blood oxygen, body temperature in Fahrenheit, a lone pulse", () => {
    const shaped = shapeVitalsGroup(
      group({
        measures: [
          { value: 97, type: 54, unit: 0 },
          { value: 3700, type: 71, unit: -2 },
          { value: 58, type: 11, unit: 0 },
        ],
      }),
    );
    expect(shaped?.title).toBe("Vitals");
    expect(shaped?.readings).toEqual([
      { metric: "heart_rate", value: 58, unit: "bpm" },
      { metric: "blood_oxygen", value: 97, unit: "%" },
      { metric: "temperature", value: 98.6, unit: "°F" },
    ]);
  });

  it("titles a group with blood pressure as blood pressure and ignores skin temperature", () => {
    const shaped = shapeVitalsGroup(group({ measures: [...group().measures, { value: 3300, type: 73, unit: -2 }] }));
    expect(shaped?.title).toBe("Blood pressure");
    expect(shaped?.readings.map((r) => r.metric)).not.toContain("temperature");
  });

  it("ignores measure types it did not ask for and values that make no sense", () => {
    const shaped = shapeVitalsGroup(
      group({
        measures: [
          { value: 70_000, type: 1, unit: -3 },
          { value: 120, type: 10, unit: 0 },
          { value: 80, type: 9, unit: 0 },
          { value: 0, type: 11, unit: 0 },
        ],
      }),
    );
    expect(shaped?.readings.map((r) => r.metric)).toEqual(["blood_pressure_systolic", "blood_pressure_diastolic"]);
  });

  it("rejects a group without an id or a usable time", () => {
    expect(shapeVitalsGroup(group({ grpid: undefined }))).toBeNull();
    expect(shapeVitalsGroup(group({ date: 0 }))).toBeNull();
    expect(shapeVitalsGroup(group({ date: Number.NaN }))).toBeNull();
  });
});

describe("shapeVitalsGroup attribution", () => {
  it.each([1, 4])("leaves out attrib %i: Withings could not say it is this person's", (attrib) => {
    expect(shapeVitalsGroup(group({ attrib }))).toBeNull();
  });

  it.each([0, 2, 5, 7, 8, 15, undefined])("keeps attrib %s", (attrib) => {
    expect(shapeVitalsGroup(group({ attrib }))).not.toBeNull();
  });
});

describe("withingsCurrentAccessToken (unlink)", () => {
  const env = { ...creds, ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" };
  const link = (expiresInMs: number) => ({
    accessTokenEncrypted: encryptWithingsSecret("access-old", env),
    refreshTokenEncrypted: encryptWithingsSecret("refresh-old", env),
    tokenExpiresAt: new Date(Date.now() + expiresInMs),
  });

  it("uses the stored token while it is good, without calling Withings", async () => {
    const { fn, calls } = fakeFetch(200, { status: 0, body: {} });
    expect(await withingsCurrentAccessToken(env as never, link(60 * 60 * 1000), new Date(), fn)).toBe("access-old");
    expect(calls).toHaveLength(0);
  });

  it("refreshes a lapsed token, since the stored one is usually stale by the time someone unlinks", async () => {
    const { fn, calls } = fakeFetch(200, {
      status: 0,
      body: { userid: 1, access_token: "access-new", refresh_token: "refresh-new", expires_in: 10800 },
    });
    expect(await withingsCurrentAccessToken(env as never, link(-1000), new Date(), fn)).toBe("access-new");
    expect(calls[0]!.body.get("grant_type")).toBe("refresh_token");
    expect(calls[0]!.body.get("refresh_token")).toBe("refresh-old");
  });
});

describe("withingsBackoffMs", () => {
  it("doubles from 30 seconds and stops at an hour", () => {
    expect(withingsBackoffMs(1)).toBe(30_000);
    expect(withingsBackoffMs(2)).toBe(60_000);
    expect(withingsBackoffMs(3)).toBe(120_000);
    expect(withingsBackoffMs(20)).toBe(60 * 60 * 1000);
  });
});

describe("withingsAuthorizeUrl", () => {
  it("carries the client, redirect, scope and state", () => {
    const url = new URL(withingsAuthorizeUrl(creds, { redirectUri: "https://app.example/cb", state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://account.withings.com/oauth2_user/authorize2");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("scope")).toBe("user.metrics,user.activity");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("refuses to run without credentials", () => {
    expect(() => withingsAuthorizeUrl({}, { redirectUri: "x", state: "y" })).toThrowError(WithingsError);
  });
});

function fakeFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; body: URLSearchParams; auth: string | null }> = [];
  const fn = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")), auth: headers.get("authorization") });
    return new Response(JSON.stringify(json), { status });
  };
  return { fn, calls };
}

describe("Withings client", () => {
  it("exchanges a code for tokens", async () => {
    const { fn, calls } = fakeFetch(200, {
      status: 0,
      body: { userid: 9001, access_token: "a", refresh_token: "r", expires_in: 10800, scope: "user.metrics" },
    });
    const tokens = await withingsExchangeCode(creds, "the-code", "https://app.example/cb", fn);
    expect(tokens).toEqual({ userId: "9001", accessToken: "a", refreshToken: "r", expiresInSec: 10800, scope: "user.metrics" });
    expect(calls[0]!.body.get("action")).toBe("requesttoken");
    expect(calls[0]!.body.get("grant_type")).toBe("authorization_code");
    expect(calls[0]!.body.get("code")).toBe("the-code");
    expect(calls[0]!.auth).toBeNull();
  });

  it("subscribes for blood pressure notifications with the access token", async () => {
    const { fn, calls } = fakeFetch(200, { status: 0, body: {} });
    await withingsSubscribe("tok", "https://app.example/hook?t=x", fn);
    expect(calls[0]!.body.get("action")).toBe("subscribe");
    expect(calls[0]!.body.get("appli")).toBe("4");
    expect(calls[0]!.body.get("callbackurl")).toBe("https://app.example/hook?t=x");
    expect(calls[0]!.auth).toBe("Bearer tok");
  });

  it("also subscribes for workouts when the link may read them, and tolerates that one failing", async () => {
    const calls: string[] = [];
    const fn = (async (_u: unknown, init: { body: string }) => {
      const appli = new URLSearchParams(init.body).get("appli")!;
      calls.push(appli);
      return new Response(JSON.stringify(appli === "16" ? { status: 293 } : { status: 0, body: {} }), { status: 200 });
    }) as never;
    await withingsSubscribe("tok", "https://app.example/hook", fn, { workouts: true });
    expect(calls).toEqual(["4", "16"]);
    calls.length = 0;
    await withingsUnsubscribe("tok", "https://app.example/hook", fn);
    expect(calls).toEqual(["4", "16"]);
  });

  it.each([
    [200, { status: 343 }, "token_invalid"],
    [200, { status: 401 }, "token_invalid"],
    // "credentials absent or incorrect" can be our own app secret: it must retry, not flip links to reconnect.
    [200, { status: 342 }, "transient"],
    [200, { status: 601 }, "rate_limited"],
    [429, {}, "rate_limited"],
    [200, { status: 2554 }, "transient"],
    [503, {}, "transient"],
  ])("maps HTTP %i %j to %s", async (httpStatus, body, code) => {
    const { fn } = fakeFetch(httpStatus, body);
    await expect(withingsSubscribe("tok", "https://app.example/hook", fn)).rejects.toMatchObject({ code });
  });

  it("treats an unreachable Withings as transient", async () => {
    const down = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(withingsSubscribe("tok", "https://app.example/hook", down)).rejects.toMatchObject({ code: "transient" });
  });

  it("rejects a token response missing a field", async () => {
    const { fn } = fakeFetch(200, { status: 0, body: { userid: 1, access_token: "a" } });
    await expect(withingsExchangeCode(creds, "c", "https://app.example/cb", fn)).rejects.toMatchObject({ code: "transient" });
  });
});

describe("withingsScopeAllowsWorkouts", () => {
  it("needs the activity scope, however Withings separates it", () => {
    expect(withingsScopeAllowsWorkouts("user.metrics,user.activity")).toBe(true);
    expect(withingsScopeAllowsWorkouts("user.metrics user.activity")).toBe(true);
    expect(withingsScopeAllowsWorkouts("user.metrics")).toBe(false);
    expect(withingsScopeAllowsWorkouts(null)).toBe(false);
  });
});

describe("shapeWorkout", () => {
  const workout = (over: Record<string, unknown> = {}) => ({
    id: 9001,
    category: 2,
    startdate: 1_791_000_000,
    enddate: 1_791_001_800,
    data: { distance: 5230, calories: 311.6, steps: 6100, hr_average: 141 },
    ...over,
  });

  it("turns a run into a named exercise with minutes, kilometres and calories", () => {
    expect(shapeWorkout(workout())).toMatchObject({
      key: "workout:9001",
      activity: "Running",
      durationMinutes: 30,
      distanceKm: 5.23,
      calories: 312,
    });
  });

  it("calls an unknown category a workout and leaves out figures it was not given", () => {
    const shaped = shapeWorkout(workout({ category: 9999, data: {} }));
    expect(shaped).toMatchObject({ activity: "Workout", distanceKm: null, calories: null });
  });

  it("rejects a workout with no usable span", () => {
    expect(shapeWorkout(workout({ enddate: 1_791_000_000 }))).toBeNull();
    expect(shapeWorkout(workout({ id: undefined }))).toBeNull();
  });
});

describe("shapeActivity", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    date: "2026-09-10",
    deviceid: "watch-1",
    is_tracker: true,
    modified: 1_790_300_000,
    steps: 8421.4,
    distance: 6230.6,
    active: 2430,
    calories: 310.4,
    totalcalories: 2105.9,
    ...over,
  });

  it("rounds to whole units and turns active seconds into minutes", () => {
    expect(shapeActivity(row())).toEqual({
      date: "2026-09-10",
      deviceKey: "watch-1",
      isTracker: true,
      steps: 8421,
      distanceM: 6231,
      activeMinutes: 41,
      caloriesActive: 310,
      caloriesTotal: 2106,
      modified: 1_790_300_000,
    });
  });

  it("prefers the hashed device id, and tolerates a row without one", () => {
    expect(shapeActivity(row({ hash_deviceid: "h1" }))!.deviceKey).toBe("h1");
    expect(shapeActivity(row({ deviceid: undefined }))!.deviceKey).toBe("");
  });

  it("keeps a zero-step day, and drops what has no usable numbers or date", () => {
    expect(shapeActivity({ date: "2026-09-10", steps: 0 })).toMatchObject({ steps: 0 });
    expect(shapeActivity({ date: "2026-09-10" })).toBeNull();
    expect(shapeActivity(row({ date: "10/09/2026" }))).toBeNull();
    expect(shapeActivity(row({ steps: -5, distance: undefined, active: undefined, calories: undefined, totalcalories: undefined }))).toBeNull();
  });
});
