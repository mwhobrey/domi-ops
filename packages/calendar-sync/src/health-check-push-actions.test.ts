import { describe, expect, it } from "vitest";
import { verifyHealthCheckPushActionToken, verifyHealthMedPushActionToken } from "@domi-ops/crypto";
import { CHECK_PUSH_ACTIONS, checkReminderPushExtras } from "./health-check-push-actions.js";

const key = "test-health-encryption-key-32chars!!";
const input = {
  householdId: "hh-1",
  userId: "user-1",
  checkId: "check-1",
  scheduledAt: new Date("2026-10-02T17:05:00.000Z"),
  timeZone: "America/Chicago",
};

describe("checkReminderPushExtras", () => {
  it("offers Log now and Skip, with a token for this person and slot that only allows a skip", () => {
    const extras = checkReminderPushExtras({ ENCRYPTION_KEY: key }, input);
    expect(extras).toMatchObject({ actions: [...CHECK_PUSH_ACTIONS] });
    if (!("data" in extras)) throw new Error("expected data");
    expect(extras.data).toMatchObject({
      checkId: "check-1",
      scheduledAt: "2026-10-02T17:05:00.000Z",
      timeZone: "America/Chicago",
    });
    expect(verifyHealthCheckPushActionToken(extras.data.token, key)).toMatchObject({
      householdId: "hh-1",
      userId: "user-1",
      checkId: "check-1",
      scheduledAt: "2026-10-02T17:05:00.000Z",
      actions: ["skipped"],
    });
    // Not a medication token.
    expect(verifyHealthMedPushActionToken(extras.data.token, key)).toBeNull();
  });

  it("falls back to the session secret, like medication reminders", () => {
    const extras = checkReminderPushExtras({ SESSION_SECRET: "session-secret-for-dev-only!!" }, input);
    expect("actions" in extras).toBe(true);
  });

  it("sends a plain notification when nothing can sign the token", () => {
    expect(checkReminderPushExtras({}, input)).toEqual({});
  });
});
