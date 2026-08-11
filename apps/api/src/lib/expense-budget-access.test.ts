import { describe, expect, it } from "vitest";
import {
  canViewBudget,
  canWriteBudget,
  isBudgetOwner,
  isHouseholdBudget,
  shareAccessAtLeast,
} from "./expense-budget-access.js";

describe("isHouseholdBudget", () => {
  it("treats null memberId as household", () => {
    expect(isHouseholdBudget({ memberId: null })).toBe(true);
    expect(isHouseholdBudget({ memberId: "m1" })).toBe(false);
  });
});

describe("budget access matrix", () => {
  const auth = { memberId: "me" };
  const household = { memberId: null };
  const mine = { memberId: "me" };
  const theirs = { memberId: "them" };

  it("household: any member can view and write", () => {
    expect(canViewBudget(auth, household, null)).toBe(true);
    expect(canWriteBudget(auth, household, null)).toBe(true);
    expect(isBudgetOwner(auth, household)).toBe(false);
  });

  it("owner: full access on personal budget", () => {
    expect(canViewBudget(auth, mine, null)).toBe(true);
    expect(canWriteBudget(auth, mine, null)).toBe(true);
    expect(isBudgetOwner(auth, mine)).toBe(true);
  });

  it("read share: view only", () => {
    expect(canViewBudget(auth, theirs, "read")).toBe(true);
    expect(canWriteBudget(auth, theirs, "read")).toBe(false);
    expect(isBudgetOwner(auth, theirs)).toBe(false);
  });

  it("write share: view and write", () => {
    expect(canViewBudget(auth, theirs, "write")).toBe(true);
    expect(canWriteBudget(auth, theirs, "write")).toBe(true);
  });

  it("stranger: no access without share", () => {
    expect(canViewBudget(auth, theirs, null)).toBe(false);
    expect(canWriteBudget(auth, theirs, null)).toBe(false);
  });
});

describe("shareAccessAtLeast", () => {
  it("ranks read < write", () => {
    expect(shareAccessAtLeast(null, "read")).toBe(false);
    expect(shareAccessAtLeast("read", "read")).toBe(true);
    expect(shareAccessAtLeast("read", "write")).toBe(false);
    expect(shareAccessAtLeast("write", "read")).toBe(true);
    expect(shareAccessAtLeast("write", "write")).toBe(true);
  });
});
