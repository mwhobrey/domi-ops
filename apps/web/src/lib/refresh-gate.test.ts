import { describe, expect, it } from "vitest";
import { createRefreshGate } from "./refresh-gate";

/** A run that finishes when the test says so, and a clock the test moves. */
function setup(minGapMs = 2000) {
  let clock = 10_000;
  const finishers: Array<() => void> = [];
  let started = 0;
  const run = () => {
    started += 1;
    return new Promise<void>((resolve) => finishers.push(resolve));
  };
  const gate = createRefreshGate(run, { minGapMs, now: () => clock });
  const finish = async () => {
    finishers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { gate, finish, advance: (ms: number) => (clock += ms), started: () => started };
}

describe("createRefreshGate", () => {
  it("runs a passive trigger when idle", () => {
    const t = setup();
    t.gate.passive();
    expect(t.started()).toBe(1);
  });

  it("drops passive triggers while a run is in flight (focus and visibility together)", async () => {
    const t = setup();
    t.gate.passive();
    t.gate.passive();
    t.gate.passive();
    expect(t.started()).toBe(1);
    await t.finish();
    expect(t.started()).toBe(1);
  });

  it("drops a passive trigger while a slow run is still in flight, even after the gap has passed", () => {
    const t = setup(2000);
    t.gate.passive();
    t.advance(60_000);
    t.gate.passive();
    expect(t.started()).toBe(1);
  });

  it("drops a passive trigger that comes right after a run, and allows one once the gap has passed", async () => {
    const t = setup(2000);
    t.gate.passive();
    await t.finish();
    t.advance(500);
    t.gate.passive();
    expect(t.started()).toBe(1);
    t.advance(1600);
    t.gate.passive();
    expect(t.started()).toBe(2);
  });

  it("runs an explicit trigger even right after a run, and ignores the gap", async () => {
    const t = setup(2000);
    t.gate.explicit();
    await t.finish();
    t.advance(10);
    t.gate.explicit();
    expect(t.started()).toBe(2);
  });

  it("gives an explicit trigger that arrives during a run exactly one follow-up, however many arrive", async () => {
    const t = setup();
    t.gate.explicit();
    t.gate.explicit();
    t.gate.explicit();
    expect(t.started()).toBe(1);
    await t.finish();
    expect(t.started()).toBe(2);
    await t.finish();
    expect(t.started()).toBe(2);
  });

  it("does not let a passive trigger in during the follow-up", async () => {
    const t = setup();
    t.gate.explicit();
    t.gate.explicit();
    await t.finish();
    t.gate.passive();
    expect(t.started()).toBe(2);
  });

  it("keeps going after a run that throws", async () => {
    let calls = 0;
    const gate = createRefreshGate(
      async () => {
        calls += 1;
        throw new Error("network");
      },
      { minGapMs: 0, now: () => calls * 10_000 },
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    gate.explicit();
    await new Promise((r) => setTimeout(r, 0));
    gate.explicit();
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", onUnhandled);
    expect(calls).toBe(2);
    expect(unhandled).toEqual([]);
  });
});
