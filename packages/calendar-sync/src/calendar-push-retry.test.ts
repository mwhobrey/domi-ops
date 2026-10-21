import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@domi-ops/db";
import { fanOutCalendarPushes } from "./calendar-push-retry.js";
import { ensureCalendarPushScheduler } from "./queue.js";

const state = vi.hoisted(() => ({ add: vi.fn(), scheduler: vi.fn() }));
vi.mock("bullmq", () => ({ Queue: class {
  add = state.add;
  upsertJobScheduler = state.scheduler;
} }));

describe("durable Calendar outbox wakeups", () => {
  const db = { selectDistinct: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [
    { id: "connection-a", householdId: "household-a" }, { id: "connection-b", householdId: "household-b" },
  ] }) }) }) } as unknown as Database;
  beforeEach(() => vi.clearAllMocks());
  it("recreates household-scoped push jobs with stable IDs within each retry interval", async () => {
    vi.spyOn(Date, "now").mockReturnValue(120_000);
    try {
      await fanOutCalendarPushes(db, "redis://synthetic");
      await fanOutCalendarPushes(db, "redis://synthetic");
      expect(state.add).toHaveBeenNthCalledWith(1, "google.calendar.push", {
        name: "google.calendar.push", payload: { householdId: "household-a", connectionId: "connection-a" },
      }, expect.objectContaining({ jobId: "calendar-push-connection-a-2" }));
      expect(state.add).toHaveBeenNthCalledWith(2, "google.calendar.push", {
        name: "google.calendar.push", payload: { householdId: "household-b", connectionId: "connection-b" },
      }, expect.objectContaining({ jobId: "calendar-push-connection-b-2" }));
      expect(state.add.mock.calls[0][2].jobId).toBe(state.add.mock.calls[2][2].jobId);
    } finally { vi.restoreAllMocks(); }
  });
  it("registers a one-minute scan that can find intents after a worker restart", async () => {
    await ensureCalendarPushScheduler("redis://synthetic");
    expect(state.scheduler).toHaveBeenCalledWith("calendar-push-retry", { every: 60_000 }, expect.objectContaining({
      name: "google.calendar.push.scan", data: { name: "google.calendar.push.scan", payload: { householdId: "scan" } },
    }));
  });
});
