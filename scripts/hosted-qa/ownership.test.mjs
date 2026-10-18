import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOwnership, assertVolumes } from "./ownership.mjs";

test("reset identity cannot select another checkout, image, project or port set", () => {
  const root = "C:/workspace/domi", project = "domi-ops-qa-fixture";
  const state = { marker: "domi-ops-hosted-qa-v1", root, project, image: `${project}:local`, ports: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), 13180 + i])), secrets: Object.fromEntries(["ADMIN_PASSWORD", "APP_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY", "S3_PASSWORD", "TOKEN"].map((name) => [name, "a".repeat(64)])) };
  assert.doesNotThrow(() => assertOwnership(state, root, project));
  for (const mutation of [{ root: "C:/other" }, { project: "domi-ops" }, { image: "production:latest" }, { ports: { web: 5432 } }, { secrets: {} }]) assert.throws(() => assertOwnership({ ...state, ...mutation }, root, project));
});
test("reset only accepts the five named Compose volumes belonging to this harness", () => {
  const project = "domi-ops-qa-fixture";
  const volume = { Name: `${project}_database`, Labels: { "com.docker.compose.project": project, "com.docker.compose.volume": "database" } };
  assert.doesNotThrow(() => assertVolumes([volume], project));
  assert.throws(() => assertVolumes([{ ...volume, Name: "domi-ops_database" }], project));
  assert.throws(() => assertVolumes([{ ...volume, Labels: { ...volume.Labels, "com.docker.compose.project": "domi-ops" } }], project));
  assert.throws(() => assertVolumes([{ Name: `${project}_external`, Labels: { ...volume.Labels, "com.docker.compose.volume": "external" } }], project));
});
