import { describe, expect, it } from "vitest";
import {
  mintHealthCheckPushActionToken,
  mintWithingsWebhookToken,
  verifyHealthCheckPushActionToken,
  verifyWithingsWebhookToken,
} from "./index.js";

const secret = "test-encryption-key-32-chars!!";
const input = { householdId: "hh-1", linkId: "link-1" };

describe("withings webhook token", () => {
  it("round-trips mint -> verify", () => {
    expect(verifyWithingsWebhookToken(mintWithingsWebhookToken(input, secret), secret)).toEqual({
      v: 1,
      kind: "withings-webhook",
      ...input,
    });
  });

  it("does not verify under another secret", () => {
    expect(verifyWithingsWebhookToken(mintWithingsWebhookToken(input, secret), "another-secret-key-32-chars!!!")).toBeNull();
  });

  it("does not verify once the payload is changed", () => {
    const token = mintWithingsWebhookToken(input, secret);
    const sig = token.slice(token.indexOf(".") + 1);
    const forged = Buffer.from(JSON.stringify({ v: 1, kind: "withings-webhook", householdId: "hh-2", linkId: "link-1" })).toString("base64url");
    expect(verifyWithingsWebhookToken(`${forged}.${sig}`, secret)).toBeNull();
  });

  it("rejects empty and malformed tokens", () => {
    expect(verifyWithingsWebhookToken("", secret)).toBeNull();
    expect(verifyWithingsWebhookToken("nodot", secret)).toBeNull();
    expect(verifyWithingsWebhookToken(".sig", secret)).toBeNull();
    expect(verifyWithingsWebhookToken("payload.", secret)).toBeNull();
    expect(verifyWithingsWebhookToken(mintWithingsWebhookToken(input, secret), "")).toBeNull();
  });

  it("is not interchangeable with push action tokens, in either direction", () => {
    const push = mintHealthCheckPushActionToken(
      { householdId: "hh-1", userId: "u-1", checkId: "c-1", scheduledAt: "2026-08-07T14:00:00.000Z" },
      secret,
    );
    expect(verifyWithingsWebhookToken(push, secret)).toBeNull();
    expect(verifyHealthCheckPushActionToken(mintWithingsWebhookToken(input, secret), secret)).toBeNull();
  });

  it("refuses to mint without a secret", () => {
    expect(() => mintWithingsWebhookToken(input, "")).toThrow();
  });
});
