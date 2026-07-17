import { describe, expect, it } from "vitest";
import {
  isHealthRecordVisible,
  normalizeHealthVisibility,
} from "./health-access.js";

describe("normalizeHealthVisibility", () => {
  it("defaults omit and unknown to private", () => {
    expect(normalizeHealthVisibility(undefined)).toBe("private");
    expect(normalizeHealthVisibility(null)).toBe("private");
    expect(normalizeHealthVisibility("")).toBe("private");
    expect(normalizeHealthVisibility("private")).toBe("private");
    expect(normalizeHealthVisibility("weird")).toBe("private");
  });

  it("only explicit household opens the record", () => {
    expect(normalizeHealthVisibility("household")).toBe("household");
  });
});

describe("isHealthRecordVisible", () => {
  const base = {
    createdByUserId: "creator-user",
    authUserId: "other-user",
    authMemberId: "other-member",
    sharedMemberIds: [] as string[],
    householdRole: "member",
    recordMemberId: "subject-member",
  };

  it("household is visible to any household member", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "household",
      }),
    ).toBe(true);
  });

  it("private is visible to creator", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "private",
        authUserId: "creator-user",
      }),
    ).toBe(true);
  });

  it("private is visible to subject member", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "private",
        authMemberId: "subject-member",
      }),
    ).toBe(true);
  });

  it("private is visible to explicit sharee", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "private",
        sharedMemberIds: ["other-member"],
      }),
    ).toBe(true);
  });

  it("private is hidden from outsider without share", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "private",
      }),
    ).toBe(false);
  });

  it("does not grant admin override", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "private",
        householdRole: "admin",
      }),
    ).toBe(false);
  });
});
