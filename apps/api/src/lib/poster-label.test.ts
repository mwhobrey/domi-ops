import { describe, expect, it } from "vitest";
import { posterLabel } from "./poster-label.js";

function auth(overrides: Partial<Parameters<typeof posterLabel>[0]>) {
  return {
    userId: "u1",
    householdId: "hh1",
    memberId: "m1",
    role: "owner",
    email: null,
    username: null,
    name: null,
    ...overrides,
  } as Parameters<typeof posterLabel>[0];
}

describe("posterLabel", () => {
  it("prefers the member's display name", () => {
    expect(posterLabel(auth({ name: "Riley", email: "riley@example.com" }))).toBe("Riley");
  });

  // memberShownLabel() (packages/auth/src/member-label.ts) already falls back to the literal
  // string "Member" when there's no name — it never returns an empty string. That means the
  // `|| auth.email || auth.username` fallback below it in posterLabel() is unreachable dead
  // code (true in the original core.ts this was extracted from too, not introduced by the
  // split). Documented here rather than silently "fixed" — behavior-preserving refactor only.
  it("falls back to the generic label, not email/username, when there's no name", () => {
    expect(posterLabel(auth({ name: null, email: "riley@example.com" }))).toBe("Member");
    expect(posterLabel(auth({ name: null, email: null, username: "riley" }))).toBe("Member");
    expect(posterLabel(auth({ name: null, email: null, username: null }))).toBe("Member");
  });
});
