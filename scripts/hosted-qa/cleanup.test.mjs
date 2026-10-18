import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupAll } from "./cleanup.mjs";

test("a failed calendar cleanup cannot skip target cleanup or any resource finalizer", async () => {
  const calls = [], failure = new Error("calendar deletion failed");
  const steps = ["calendar", "restore database", "restore files", "queue", "S3 client", "source database", "target database", "temporary directory"];
  await assert.rejects(cleanupAll(steps.map((name) => async () => {
    calls.push(name);
    if (name === "calendar") throw failure;
  })), (error) => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === failure);
  assert.deepEqual(calls, steps);
});

test("sync and async cleanup failures are retained with the original check failure", async () => {
  const cause = new Error("archive failed"), first = new Error("queue failed"), second = new Error("database failed");
  let directoryRemoved = false;
  await assert.rejects(cleanupAll([
    () => { throw first; },
    async () => { throw second; },
    () => { directoryRemoved = true; },
  ], cause), (error) => {
    assert(error instanceof AggregateError);
    assert.equal(error.cause, cause);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
  assert.equal(directoryRemoved, true);
});

test("successful cleanup completes without changing an existing check failure", async () => {
  let closed = false;
  const cause = new Error("check failed");
  await assert.rejects(async () => {
    try { throw cause; }
    finally { await cleanupAll([async () => { closed = true; }], cause); }
  }, (error) => error === cause);
  assert.equal(closed, true);
});
