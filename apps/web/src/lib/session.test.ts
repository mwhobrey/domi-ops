import { describe, expect, it } from "vitest";
import { sessionMemberId, sessionRole } from "./session";

describe("session helpers", () => {
  it("reads memberId and role from nested user", () => {
    expect(
      sessionMemberId({
        user: { memberId: "m1", role: "admin" },
      }),
    ).toBe("m1");
    expect(sessionRole({ user: { memberId: "m1", role: "admin" } })).toBe("admin");
  });

  it("falls back to legacy top-level fields", () => {
    expect(sessionMemberId({ memberId: "legacy" })).toBe("legacy");
    expect(sessionRole({ role: "owner" })).toBe("owner");
  });

  it("defaults role to member", () => {
    expect(sessionRole({})).toBe("member");
  });
});
