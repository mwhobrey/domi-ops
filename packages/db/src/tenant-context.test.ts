import { describe, expect, it, vi } from "vitest";
import type { Database } from "./client.js";
import {
  AUTH_USER_SETTING,
  SYSTEM_ACCESS_SETTING,
  TENANT_HOUSEHOLD_SETTING,
  WORKER_SCAN_SETTING,
  withHouseholdContext,
  withSystemContext,
  withUserLookupContext,
  withWorkerScanContext,
} from "./tenant-context.js";

function mockDb() {
  const txExecute = vi.fn().mockResolvedValue(undefined);
  const transaction = vi.fn(async (fn: (tx: { execute: typeof txExecute }) => Promise<unknown>) =>
    fn({ execute: txExecute }),
  );
  return { txExecute, transaction } as unknown as Database & {
    txExecute: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
}

function setConfigSql(execute: ReturnType<typeof vi.fn>): string {
  const call = execute.mock.calls[0]?.[0];
  if (!call) return "";
  if (typeof call === "string") return call;
  if (Array.isArray(call.queryChunks)) {
    return call.queryChunks
      .map((chunk: { value?: unknown[] }) =>
        Array.isArray(chunk.value) ? chunk.value.join("") : String(chunk),
      )
      .join("");
  }
  return JSON.stringify(call);
}

describe("withHouseholdContext", () => {
  it("sets tenant household id inside a transaction", async () => {
    const db = mockDb();
    const householdId = "11111111-1111-4111-8111-111111111111";

    const result = await withHouseholdContext(db, householdId, async () => 42);

    expect(result).toBe(42);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(setConfigSql(db.txExecute)).toContain(TENANT_HOUSEHOLD_SETTING);
    expect(setConfigSql(db.txExecute)).toContain(householdId);
  });
});

describe("withUserLookupContext", () => {
  it("sets auth user id for membership lookup", async () => {
    const db = mockDb();
    const userId = "22222222-2222-4222-8222-222222222222";

    await withUserLookupContext(db, userId, async () => "ok");

    expect(setConfigSql(db.txExecute)).toContain(AUTH_USER_SETTING);
    expect(setConfigSql(db.txExecute)).toContain(userId);
  });
});

describe("withSystemContext", () => {
  it("sets system access flag", async () => {
    const db = mockDb();
    await withSystemContext(db, async () => undefined);

    expect(setConfigSql(db.txExecute)).toContain(SYSTEM_ACCESS_SETTING);
    expect(setConfigSql(db.txExecute)).toContain("true");
  });
});

describe("withWorkerScanContext", () => {
  it("sets worker scan flag", async () => {
    const db = mockDb();
    await withWorkerScanContext(db, async () => undefined);

    expect(setConfigSql(db.txExecute)).toContain(WORKER_SCAN_SETTING);
    expect(setConfigSql(db.txExecute)).toContain("true");
  });
});
