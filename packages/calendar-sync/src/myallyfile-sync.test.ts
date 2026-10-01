import { describe, expect, it } from "vitest";
import {
  MyallyfileError,
  backoffMs,
  myallyfileExchangeLinkCode,
  myallyfileSyncMedications,
  shapeSnapshot,
  snapshotHash,
  type SnapshotSourceRow,
} from "./myallyfile-sync.js";

const env = { ENCRYPTION_KEY: undefined } as { ENCRYPTION_KEY?: string };
const cfg = { DEPLOYMENT_MODE: "single" as const, MYALLYFILE_API_BASE: "http://127.0.0.1:5001/myallyfile/us-central1/" };

function row(over: Partial<SnapshotSourceRow> = {}): SnapshotSourceRow {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    name: "Lisinopril",
    dosage: "10 mg",
    instructions: "with food",
    scheduleKind: "scheduled",
    enabled: true,
    ...over,
  };
}
const on = { includePrn: false, includeOtc: false, includePaused: true };

describe("shapeSnapshot", () => {
  it("includes scheduled meds and flags paused ones", () => {
    const meds = shapeSnapshot([row(), row({ id: "b0000000-0000-4000-8000-000000000002", enabled: false })], on, env);
    expect(meds.map((m) => m.paused)).toEqual([false, true]);
  });

  it("drops paused meds when includePaused is off", () => {
    const meds = shapeSnapshot([row({ enabled: false })], { ...on, includePaused: false }, env);
    expect(meds).toEqual([]);
  });

  it("only includes PRN and OTC when toggled on", () => {
    const rows = [
      row({ id: "b0000000-0000-4000-8000-000000000001", scheduleKind: "prn" }),
      row({ id: "b0000000-0000-4000-8000-000000000002", scheduleKind: "otc" }),
    ];
    expect(shapeSnapshot(rows, on, env)).toHaveLength(0);
    expect(shapeSnapshot(rows, { ...on, includePrn: true }, env)).toHaveLength(1);
    expect(shapeSnapshot(rows, { includePrn: true, includeOtc: true, includePaused: true }, env)).toHaveLength(2);
  });

  it("truncates to the contract caps and trims blanks to null", () => {
    const [m] = shapeSnapshot(
      [row({ name: "n".repeat(300), dosage: "d".repeat(300), instructions: "   " })],
      on,
      env,
    );
    expect(m.name).toHaveLength(100);
    expect(m.dosage).toHaveLength(50);
    expect(m.instructions).toBeNull();
  });

  it("caps at 50 medications", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({ id: `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}` }),
    );
    expect(shapeSnapshot(rows, on, env)).toHaveLength(50);
  });

  it("hashes identically regardless of input order", () => {
    const a = row({ id: "b0000000-0000-4000-8000-000000000001" });
    const b = row({ id: "b0000000-0000-4000-8000-000000000002", name: "Metformin" });
    expect(snapshotHash(shapeSnapshot([a, b], on, env))).toBe(snapshotHash(shapeSnapshot([b, a], on, env)));
  });
});

describe("MyAllyFile client", () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as never;

  it("treats stale as success", async () => {
    const r = await myallyfileSyncMedications(cfg, "t", [], new Date(), json(200, { ok: true, stale: true }));
    expect(r.stale).toBe(true);
  });

  it.each([
    [401, "token_revoked", "token_revoked"],
    [403, "entitlement_required", "entitlement_required"],
    [404, "profile_not_found", "profile_not_found"],
    [422, "validation_failed", "validation_failed"],
  ])("maps %s %s", async (status, code, expected) => {
    await expect(
      myallyfileSyncMedications(cfg, "t", [], new Date(), json(status, { code })),
    ).rejects.toMatchObject({ code: expected });
  });

  it("reads Retry-After on 429", async () => {
    await expect(
      myallyfileSyncMedications(cfg, "t", [], new Date(), json(429, { code: "rate_limited" }, { "retry-after": "42" })),
    ).rejects.toMatchObject({ code: "rate_limited", opts: { retryAfterSec: 42 } });
  });

  it("maps 5xx and network failures to transient", async () => {
    await expect(myallyfileSyncMedications(cfg, "t", [], new Date(), json(503, {}))).rejects.toMatchObject({ code: "transient" });
    const boom = (async () => {
      throw new Error("down");
    }) as never;
    await expect(myallyfileSyncMedications(cfg, "t", [], new Date(), boom)).rejects.toBeInstanceOf(MyallyfileError);
  });

  it("maps a bad link code to code_invalid", async () => {
    await expect(myallyfileExchangeLinkCode(cfg, "ABCD1234", "Home", json(401, { code: "code_invalid" }))).rejects.toMatchObject({
      code: "code_invalid",
    });
  });

  it("refuses to run when sync is not enabled", async () => {
    await expect(
      myallyfileSyncMedications({ DEPLOYMENT_MODE: "single", MYALLYFILE_API_BASE: undefined }, "t", [], new Date(), json(200, {})),
    ).rejects.toMatchObject({ code: "transient" });
  });

  it("backs off exponentially up to a cap", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
