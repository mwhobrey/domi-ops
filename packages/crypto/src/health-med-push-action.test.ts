import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  mintHealthCheckPushActionToken,
  mintHealthMedGroupPushActionToken,
  mintHealthMedPushActionToken,
  verifyHealthCheckPushActionToken,
  verifyHealthMedGroupPushActionToken,
  verifyHealthMedPushActionToken,
} from "./index.js";

const secret = "test-encryption-key-32-chars!!";
const base = {
  householdId: "hh-1",
  userId: "user-1",
  medicationId: "med-1",
  scheduledAt: "2026-08-07T14:00:00.000Z",
};
const groupBase = {
  householdId: "hh-1",
  userId: "user-1",
  medicationGroupId: "group-1",
  scheduledAt: "2026-08-07T14:00:00.000Z",
};

describe("health med push action token", () => {
  it("round-trips mint → verify", () => {
    const token = mintHealthMedPushActionToken(base, secret);
    const claims = verifyHealthMedPushActionToken(token, secret);
    expect(claims).toMatchObject({
      v: 1,
      householdId: base.householdId,
      userId: base.userId,
      medicationId: base.medicationId,
      scheduledAt: base.scheduledAt,
      actions: ["taken", "skipped"],
    });
    expect(claims!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tampered payload", () => {
    const token = mintHealthMedPushActionToken(base, secret);
    const [payload, sig] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({
        ...base,
        v: 1,
        actions: ["taken", "skipped"],
        exp: Math.floor(Date.now() / 1000) + 3600,
        medicationId: "other-med",
      }),
      "utf8",
    ).toString("base64url");
    expect(verifyHealthMedPushActionToken(`${tampered}.${sig}`, secret)).toBeNull();
    expect(verifyHealthMedPushActionToken(`${payload}.deadbeef`, secret)).toBeNull();
  });

  it("rejects wrong secret", () => {
    const token = mintHealthMedPushActionToken(base, secret);
    expect(verifyHealthMedPushActionToken(token, "wrong-secret-key!!!!!!!!")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const now = Date.now();
    const token = mintHealthMedPushActionToken(
      { ...base, ttlSeconds: 60 },
      secret,
      now - 120_000,
    );
    expect(verifyHealthMedPushActionToken(token, secret, now)).toBeNull();
  });
});

describe("health med group push action token", () => {
  it("round-trips mint → verify", () => {
    const token = mintHealthMedGroupPushActionToken(groupBase, secret);
    const claims = verifyHealthMedGroupPushActionToken(token, secret);
    expect(claims).toMatchObject({
      v: 1,
      householdId: groupBase.householdId,
      userId: groupBase.userId,
      medicationGroupId: groupBase.medicationGroupId,
      scheduledAt: groupBase.scheduledAt,
      actions: ["taken", "skipped"],
    });
    expect(claims!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a single-medication token (wrong subject field)", () => {
    const token = mintHealthMedPushActionToken(base, secret);
    expect(verifyHealthMedGroupPushActionToken(token, secret)).toBeNull();
  });

  it("rejects a group token handed to the single-medication verifier", () => {
    const token = mintHealthMedGroupPushActionToken(groupBase, secret);
    expect(verifyHealthMedPushActionToken(token, secret)).toBeNull();
  });

  it("rejects tampered payload", () => {
    const token = mintHealthMedGroupPushActionToken(groupBase, secret);
    const [, sig] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...groupBase, v: 1, actions: ["taken", "skipped"], exp: Math.floor(Date.now() / 1000) + 3600, medicationGroupId: "other-group" }),
      "utf8",
    ).toString("base64url");
    expect(verifyHealthMedGroupPushActionToken(`${tampered}.${sig}`, secret)).toBeNull();
  });

  it("rejects wrong secret", () => {
    const token = mintHealthMedGroupPushActionToken(groupBase, secret);
    expect(verifyHealthMedGroupPushActionToken(token, "wrong-secret-key!!!!!!!!")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const now = Date.now();
    const token = mintHealthMedGroupPushActionToken(
      { ...groupBase, ttlSeconds: 60 },
      secret,
      now - 120_000,
    );
    expect(verifyHealthMedGroupPushActionToken(token, secret, now)).toBeNull();
  });
});

describe("health check push action token (WHO-388)", () => {
  const checkBase = {
    householdId: "hh-1",
    userId: "user-1",
    checkId: "check-1",
    scheduledAt: "2026-10-02T17:05:00.000Z",
  };

  it("round-trips, and only ever allows a skip", () => {
    const claims = verifyHealthCheckPushActionToken(mintHealthCheckPushActionToken(checkBase, secret), secret);
    expect(claims).toMatchObject({ v: 1, ...checkBase, actions: ["skipped"] });
    expect(claims!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a tampered payload, the wrong secret and an expired token", () => {
    const token = mintHealthCheckPushActionToken(checkBase, secret);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, ...checkBase, checkId: "other", actions: ["skipped"], exp: Math.floor(Date.now() / 1000) + 3600 }),
      "utf8",
    ).toString("base64url");
    expect(verifyHealthCheckPushActionToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyHealthCheckPushActionToken(token, "wrong-secret-key!!!!!!!!")).toBeNull();
    const past = Date.now() - 5 * 60 * 60 * 1000;
    expect(verifyHealthCheckPushActionToken(mintHealthCheckPushActionToken(checkBase, secret, past), secret)).toBeNull();
  });

  it("is not interchangeable with medication or medication group tokens", () => {
    const check = mintHealthCheckPushActionToken(checkBase, secret);
    expect(verifyHealthMedPushActionToken(check, secret)).toBeNull();
    expect(verifyHealthMedGroupPushActionToken(check, secret)).toBeNull();
    const med = mintHealthMedPushActionToken(base, secret);
    const group = mintHealthMedGroupPushActionToken(groupBase, secret);
    expect(verifyHealthCheckPushActionToken(med, secret)).toBeNull();
    expect(verifyHealthCheckPushActionToken(group, secret)).toBeNull();
  });

  it("rejects a validly signed token that claims more than a skip", () => {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, ...checkBase, actions: ["taken", "skipped"], exp: Math.floor(Date.now() / 1000) + 3600 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    expect(verifyHealthCheckPushActionToken(`${payload}.${sig}`, secret)).toBeNull();
  });
});
