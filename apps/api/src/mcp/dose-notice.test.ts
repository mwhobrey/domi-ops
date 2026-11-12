import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Env } from "@domi-ops/config";
import { pushSubscriptions, users, type Database } from "@domi-ops/db";

const push = vi.hoisted(() => ({ deliver: vi.fn() }));
vi.mock("@domi-ops/calendar-sync", async (original) => ({ ...await original<typeof import("@domi-ops/calendar-sync")>(), deliverUserNotificationToSubscriptions: push.deliver }));

import { pushDoseNotice, type DoseNotice } from "./med-groups.js";
import { reportAfterCommitFailure } from "./gateway.js";

const env = {} as Env;
const notice: DoseNotice = { userId: randomUUID(), householdId: randomUUID(), title: "Fictional client recorded medication as taken",
  body: "An assistant you connected recorded a medication group as taken at your request. If that is not right, correct it in Health.", url: "/health", tag: "mcp-med:fixture" };
const subscription = { id: randomUUID(), userId: notice.userId, platform: "web", endpoint: "https://push.example.test/fixture", p256dh: "synthetic-key", authKey: "synthetic-auth", deviceToken: null, timezone: null, createdAt: new Date() };

/** Answers the two reads the function makes and records which tables it touched. */
function store(enabled: boolean | undefined, subscriptions: unknown[]) {
  const read: unknown[] = [];
  const tx = { select: () => ({ from: (table: unknown) => ({ where: async () => {
    read.push(table);
    if (table === users) return enabled === undefined ? [] : [{ enabled }];
    if (table === pushSubscriptions) return subscriptions;
    throw new Error("unexpected table");
  } }) }) } as unknown as Database;
  return { tx, read };
}

describe("assistant dose notice push", () => {
  afterEach(() => { push.deliver.mockReset(); vi.restoreAllMocks(); });

  it("delivers the notice once, unchanged, to a member with health pushes on", async () => {
    const { tx } = store(true, [subscription]);
    await pushDoseNotice(tx, env, notice);
    expect(push.deliver).toHaveBeenCalledTimes(1);
    expect(push.deliver).toHaveBeenCalledWith(tx, env, { ...notice, subscriptions: [subscription] });
  });

  it("sends nothing when health pushes are off, and does not look up devices", async () => {
    const { tx, read } = store(false, [subscription]);
    await pushDoseNotice(tx, env, notice);
    expect(push.deliver).not.toHaveBeenCalled();
    expect(read).toEqual([users]);
  });

  it("sends nothing for a member with no device or no account row", async () => {
    await pushDoseNotice(store(true, []).tx, env, notice);
    await pushDoseNotice(store(undefined, [subscription]).tx, env, notice);
    expect(push.deliver).not.toHaveBeenCalled();
  });

  it("lets a delivery failure reach the caller, which is what reports it", async () => {
    push.deliver.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(pushDoseNotice(store(true, [subscription]).tx, env, notice)).rejects.toThrow("provider unavailable");
  });
});

describe("after-commit failure report", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("names the tool, the connection and the error class, and never the error text", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const connectionId = randomUUID();
    class PushFailed extends Error { override name = "PushFailed"; }
    reportAfterCommitFailure("log_medication_group", connectionId, new PushFailed("Fictional-secret-med Morning 08:00 endpoint https://push.example.test/token"));
    reportAfterCommitFailure("log_medication_group", connectionId, "Fictional-secret-med thrown as a string");
    expect(errors.mock.calls).toEqual([
      ["[mcp] after-commit step failed", { tool: "log_medication_group", connectionId, error: "PushFailed" }],
      ["[mcp] after-commit step failed", { tool: "log_medication_group", connectionId, error: "unknown" }],
    ]);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/Fictional-secret-med|Morning|08:00|push\.example/);
  });
});
