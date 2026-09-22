import { describe, expect, it } from "vitest";
import { canManageGoal } from "./goals-access.js";

describe("canManageGoal", () => {
  it("lets a member manage their own goal", () => {
    expect(canManageGoal("member", "member-1", "member-1")).toBe(true);
  });

  it("blocks a plain member from managing someone else's goal", () => {
    expect(canManageGoal("member", "member-1", "member-2")).toBe(false);
  });

  it("lets an admin manage any household member's goal", () => {
    expect(canManageGoal("admin", "member-1", "member-2")).toBe(true);
  });

  it("lets an owner manage any household member's goal", () => {
    expect(canManageGoal("owner", "member-1", "member-2")).toBe(true);
  });

  it("blocks a child role from managing someone else's goal", () => {
    expect(canManageGoal("child", "member-1", "member-2")).toBe(false);
  });

  it("blocks a guest role from managing someone else's goal", () => {
    expect(canManageGoal("guest", "member-1", "member-2")).toBe(false);
  });
});
