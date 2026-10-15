import { describe, expect, it } from "vitest";
import {
  WITHINGS_DEFAULT_HISTORY_DAYS,
  WITHINGS_HISTORY_OPTIONS,
  withingsActionError,
  withingsLinkState,
  withingsResultNotice,
  type WithingsLink,
} from "./withings-helpers";

const link = (over: Partial<WithingsLink> = {}): WithingsLink => ({
  memberId: "m1",
  status: "active",
  linkedAt: "2026-10-13T12:00:00.000Z",
  backfillFrom: "2025-10-13T12:00:00.000Z",
  backfillDone: true,
  lastSyncedAt: "2026-10-13T12:05:00.000Z",
  lastError: null,
  workouts: true,
  syncPending: false,
  ...over,
});

describe("withingsLinkState", () => {
  it("reads Not connected with no link", () => {
    expect(withingsLinkState(null)).toEqual({ label: "Not connected", tone: "default", settling: false });
  });

  it("is Connected once history is in and nothing is pending", () => {
    expect(withingsLinkState(link())).toEqual({ label: "Connected", tone: "success", settling: false });
  });

  it("says Importing history until the first pull has finished, even if a sync is also pending", () => {
    const state = withingsLinkState(link({ backfillDone: false, syncPending: true }));
    expect(state).toMatchObject({ label: "Importing history…", settling: true });
  });

  it("says Syncing for a pending pull after history, and keeps polling", () => {
    expect(withingsLinkState(link({ syncPending: true }))).toMatchObject({ label: "Syncing…", settling: true });
  });

  it("does not poll a link that needs a person to act", () => {
    expect(withingsLinkState(link({ status: "revoked", backfillDone: false, syncPending: true }))).toEqual({
      label: "Disconnected",
      tone: "warning",
      settling: false,
    });
    expect(withingsLinkState(link({ status: "error", syncPending: true }))).toMatchObject({
      label: "Needs attention",
      settling: false,
    });
  });
});

describe("history options", () => {
  it("defaults to a window the list actually offers", () => {
    expect(WITHINGS_HISTORY_OPTIONS.map((o) => o.days)).toContain(WITHINGS_DEFAULT_HISTORY_DAYS);
  });

  it("stays inside what the API accepts (1 to 3650 days)", () => {
    for (const o of WITHINGS_HISTORY_OPTIONS) {
      expect(o.days).toBeGreaterThanOrEqual(1);
      expect(o.days).toBeLessThanOrEqual(3650);
    }
  });
});

describe("withingsResultNotice", () => {
  it("shows nothing when there was no round trip", () => {
    expect(withingsResultNotice(undefined)).toBeNull();
    expect(withingsResultNotice("")).toBeNull();
  });

  it.each([
    ["connected", "success"],
    ["denied", "info"],
    ["already_linked", "info"],
    ["expired", "error"],
    ["forbidden", "error"],
    ["unavailable", "error"],
    ["error", "error"],
  ])("maps %s to a %s notice", (result, variant) => {
    const notice = withingsResultNotice(result);
    expect(notice?.variant).toBe(variant);
    expect(notice?.message.length).toBeGreaterThan(10);
  });

  it("shows an unknown result as a failure instead of hiding it", () => {
    expect(withingsResultNotice("something-new")?.variant).toBe("error");
  });
});

describe("withingsActionError", () => {
  it("explains the statuses the API actually returns", () => {
    for (const status of [403, 404, 409, 503]) {
      expect(withingsActionError(status)).not.toBe(withingsActionError(500));
    }
    expect(withingsActionError(null)).toBe("Something went wrong. Try again.");
  });
});
