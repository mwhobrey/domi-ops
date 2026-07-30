import { describe, expect, it } from "vitest";
import {
  aclLevelAtLeast,
  canAccessHealthSegment,
  effectiveMedicationsAccess,
  emptyHealthAclGrants,
  isHealthRecordVisible,
  normalizeHealthAclLevel,
  normalizeHealthVisibility,
  type HealthAclGrants,
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

describe("normalizeHealthAclLevel", () => {
  it("accepts none/read/write and defaults unknown", () => {
    expect(normalizeHealthAclLevel("none")).toBe("none");
    expect(normalizeHealthAclLevel("read")).toBe("read");
    expect(normalizeHealthAclLevel("write")).toBe("write");
    expect(normalizeHealthAclLevel("admin")).toBe("none");
    expect(normalizeHealthAclLevel(undefined)).toBe("none");
  });
});

describe("effectiveMedicationsAccess", () => {
  it("doses write implies medications read", () => {
    const grants: HealthAclGrants = {
      ...emptyHealthAclGrants(),
      doses: "write",
    };
    expect(effectiveMedicationsAccess(grants)).toBe("read");
    expect(canAccessHealthSegment(grants, "medications", "read")).toBe(true);
    expect(canAccessHealthSegment(grants, "medications", "write")).toBe(false);
    expect(canAccessHealthSegment(grants, "doses", "write")).toBe(true);
  });

  it("does not downgrade medications write", () => {
    const grants: HealthAclGrants = {
      ...emptyHealthAclGrants(),
      medications: "write",
      doses: "none",
    };
    expect(effectiveMedicationsAccess(grants)).toBe("write");
  });
});

describe("aclLevelAtLeast", () => {
  it("ranks none < read < write", () => {
    expect(aclLevelAtLeast("read", "none")).toBe(true);
    expect(aclLevelAtLeast("read", "read")).toBe(true);
    expect(aclLevelAtLeast("read", "write")).toBe(false);
    expect(aclLevelAtLeast("write", "read")).toBe(true);
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

  it("segment ACL read makes private visible", () => {
    expect(
      isHealthRecordVisible({
        ...base,
        visibility: "private",
        segmentAccess: "read",
      }),
    ).toBe(true);
  });
});
