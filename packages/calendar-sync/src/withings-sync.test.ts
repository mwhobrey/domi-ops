import { describe, expect, it } from "vitest";
import {
  WithingsError,
  shapeBloodPressureGroup,
  withingsAuthorizeUrl,
  withingsBackoffMs,
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

describe("shapeBloodPressureGroup", () => {
  it("maps systolic, diastolic and pulse, in that order, with the measured instant", () => {
    const shaped = shapeBloodPressureGroup(group());
    expect(shaped).toEqual({
      grpid: "4242",
      measuredAt: new Date(1_791_000_000 * 1000),
      readings: [
        { metric: "blood_pressure_systolic", value: 128, unit: "mmHg" },
        { metric: "blood_pressure_diastolic", value: 82, unit: "mmHg" },
        { metric: "heart_rate", value: 64, unit: "bpm" },
      ],
    });
  });

  it("applies the power-of-ten unit", () => {
    const shaped = shapeBloodPressureGroup(
      group({ measures: [{ value: 1285, type: 10, unit: -1 }, { value: 82, type: 9, unit: 0 }] }),
    );
    expect(shaped?.readings[0]).toEqual({ metric: "blood_pressure_systolic", value: 128.5, unit: "mmHg" });
  });

  it("keeps a reading without a pulse", () => {
    const shaped = shapeBloodPressureGroup(group({ measures: [{ value: 120, type: 10, unit: 0 }, { value: 80, type: 9, unit: 0 }] }));
    expect(shaped?.readings.map((r) => r.metric)).toEqual(["blood_pressure_systolic", "blood_pressure_diastolic"]);
  });

  it("is not a blood pressure reading without both pressures", () => {
    expect(shapeBloodPressureGroup(group({ measures: [{ value: 64, type: 11, unit: 0 }] }))).toBeNull();
    expect(shapeBloodPressureGroup(group({ measures: [{ value: 120, type: 10, unit: 0 }] }))).toBeNull();
    expect(shapeBloodPressureGroup(group({ measures: [] }))).toBeNull();
  });

  it("ignores measure types it did not ask for and values that make no sense", () => {
    const shaped = shapeBloodPressureGroup(
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
    expect(shapeBloodPressureGroup(group({ grpid: undefined }))).toBeNull();
    expect(shapeBloodPressureGroup(group({ date: 0 }))).toBeNull();
    expect(shapeBloodPressureGroup(group({ date: Number.NaN }))).toBeNull();
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
    expect(url.searchParams.get("scope")).toBe("user.metrics");
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

  it.each([
    [200, { status: 401 }, "token_invalid"],
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
