import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupAll, restorePrefixCleanupSteps } from "./cleanup.mjs";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

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

test("a listing failure cannot skip later restore prefixes or resource closure", async () => {
  const calls = [], failure = new Error("list denied"), prefixes = ["drive/", "school/", "avatars/", "households/"];
  const client = { send: async (command) => {
    assert(command instanceof ListObjectsV2Command);
    assert.equal(command.input.Bucket, "restore");
    calls.push(command.input.Prefix);
    if (command.input.Prefix === "drive/") throw failure;
    return {};
  } };
  await assert.rejects(cleanupAll([
    ...restorePrefixCleanupSteps(client, "restore", prefixes),
    () => { calls.push("closed"); },
  ]), (error) => {
    assert.deepEqual(error.errors[0].errors, [failure]);
    return true;
  });
  assert.deepEqual(calls, [...prefixes, "closed"]);
});

test("a failed object deletion cannot skip other objects, pages or prefixes", async () => {
  const calls = [], failure = new Error("delete denied");
  const client = { send: async (command) => {
    const input = command.input;
    if (command instanceof ListObjectsV2Command) {
      calls.push(`list:${input.Prefix}:${input.ContinuationToken ?? "first"}`);
      if (input.Prefix === "school/") return { Contents: [{ Key: "school/file" }] };
      return input.ContinuationToken
        ? { Contents: [{ Key: "drive/second-page" }] }
        : { Contents: [{ Key: "drive/denied" }, { Key: "drive/allowed" }], IsTruncated: true, NextContinuationToken: "next" };
    }
    assert(command instanceof DeleteObjectCommand);
    calls.push(`delete:${input.Key}`);
    if (input.Key === "drive/denied") throw failure;
  } };
  await assert.rejects(cleanupAll(restorePrefixCleanupSteps(client, "restore", ["drive/", "school/"])), (error) => {
    assert.deepEqual(error.errors[0].errors, [failure]);
    return true;
  });
  assert.deepEqual(calls, ["list:drive/:first", "delete:drive/denied", "delete:drive/allowed", "list:drive/:next", "delete:drive/second-page", "list:school/:first", "delete:school/file"]);
});

test("a later listing failure retains earlier deletion errors and still attempts the next prefix", async () => {
  const deletion = new Error("delete failed"), listing = new Error("next page failed"), cause = new Error("check failed");
  const prefixes = [];
  const client = { send: async (command) => {
    if (command instanceof DeleteObjectCommand) throw deletion;
    prefixes.push(command.input.Prefix);
    if (command.input.Prefix === "school/") return {};
    if (command.input.ContinuationToken) throw listing;
    return { Contents: [{ Key: "drive/file" }], IsTruncated: true, NextContinuationToken: "next" };
  } };
  await assert.rejects(cleanupAll(restorePrefixCleanupSteps(client, "restore", ["drive/", "school/"]), cause), (error) => {
    assert.equal(error.cause, cause);
    assert.deepEqual(error.errors[0].errors, [deletion, listing]);
    return true;
  });
  assert.deepEqual(prefixes, ["drive/", "drive/", "school/"]);
});
