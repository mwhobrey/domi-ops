import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { pluginConfiguration, writePlugin } from "./package.mjs";
import { prepareSubmission } from "./prepare-submission.mjs";
import { writeReviewMaterials } from "../mcp-review/materials.mjs";

test("review cases stay within enabled tools and keep real acceptance pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-mcp-package-"));
  try {
    for (const scopes of [["chores:read"], ["notes:read"], ["shopping:read", "chores:read", "notes:read"]]) {
      const plan = await writeReviewMaterials({ output: root, scopes, packageVersion: "0.1.1" });
      assert.equal(plan.readyToSubmit, false);
      assert.equal(plan.review.test_cases.positive.length, 5);
      assert.equal(plan.review.test_cases.negative.length, 3);
      const tools = plan.review.test_cases.positive.map(c => c.tools_triggered).join(",");
      assert.equal(tools.includes("list_shopping_items"), scopes.includes("shopping:read"));
      assert.equal(tools.includes("list_chores"), scopes.includes("chores:read"));
      assert.equal(tools.includes("get_selected_note"), scopes.includes("notes:read"));
      assert.deepEqual(plan.execution.results, []);
    }
    await assert.rejects(writeReviewMaterials({ output: root, scopes: ["offline_access"] }));
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-mcp-package-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("submission draft includes portable source, public listing assets and explicit launch gates", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-mcp-package-")), output = join(root, "draft");
  try {
    const draft = await prepareSubmission({ origin: "https://hosted.example.test", output });
    assert.equal(draft.readyToSubmit, false);
    assert.equal(draft.status, "draft-not-uploaded");
    const review = JSON.parse(await readFile(join(output, "review-plan.draft.json"), "utf8"));
    assert.equal(review.execution.status, "not-run");
    assert.equal(review.packageVersion, "0.1.1");
    assert.equal(review.recording.url, null);
    assert.equal(review.review.test_cases.positive.length, 5);
    assert.equal(review.review.test_cases.negative.length, 3);
    assert.ok(review.review.test_cases.positive.every(c => c.prompt && c.tools_triggered && c.expected_behavior));
    assert.equal(JSON.stringify(review.review.test_cases.positive).includes("get_selected_note"), false);
    assert.ok((await readFile(join(output, "recording-outline.md"), "utf8")).includes("not a recording"));
    assert.deepEqual(draft.scopes, ["shopping:read", "chores:read", "offline_access"]);
    const manifest = JSON.parse(await readFile(join(output, "plugin/plugin.json"), "utf8"));
    const listing = manifest.extensions["com.openai"].interface;
    assert.ok(listing.shortDescription.length <= 30);
    assert.deepEqual(await readFile(join(output, "plugin", listing.logo)), await readFile(new URL("../../apps/web/public/icons/icon-512.png", import.meta.url)));
    assert.ok((await readFile(join(output, "plugin/README.md"), "utf8")).includes(draft.serverUrl));
    assert.ok(draft.requiredBeforeSubmit.some(gate => gate.includes("actual registration-free")));
    const savedDraft = JSON.parse(await readFile(join(output, "listing.draft.json"), "utf8"));
    const guide = (await readFile(join(output, "submission-guide.md"), "utf8")).replace(/\s+/g, " ").toLowerCase();
    for (const material of ["five positive test cases", "three negative test cases", "video walkthrough", "release notes"]) {
      assert.ok(savedDraft.requiredBeforeSubmit.some(gate => gate.includes(material)), `Missing submission gate: ${material}`);
      assert.ok(guide.includes(material), `Missing submission guidance: ${material}`);
    }
    await assert.rejects(prepareSubmission({ origin: "https://hosted.example.test", output }), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-mcp-package-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("published-identity packages use canonical public origins and default to the no-notes pilot", () => {
  for (const origin of ["https://hosted.example.test", "https://home.example.test"]) {
    const config = pluginConfiguration({ origin, clientMode: "cimd" });
    const auth = config.mcp.mcpServers["domi-ops"].extensions["com.openai"].auth;
    assert.deepEqual(auth.client, { mode: "cimd" });
    assert.equal(auth.resource, origin + "/api/mcp");
    assert.deepEqual(auth.defaultScopes, ["shopping:read", "chores:read", "offline_access"]);
    assert.deepEqual(auth.baseScopes, ["offline_access"]);
    assert.equal(/clientSecret|clientId|Authorization|apiKey/.test(JSON.stringify(config)), false);
    assert.deepEqual(pluginConfiguration({ origin, clientMode: "cimd", readScopes: ["chores:read"] }).mcp.mcpServers["domi-ops"].extensions["com.openai"].auth.defaultScopes, ["chores:read", "offline_access"]);
  }
  for (const origin of ["http://localhost:17180", "https://localhost", "https://10.0.0.1", "https://[::1]"]) assert.throws(() => pluginConfiguration({ origin, clientMode: "cimd" }));
  assert.throws(() => pluginConfiguration({ origin: "https://home.example.test", clientMode: "cimd", clientId: "manual" }));
  for (const readScopes of [[], ["notes:read", "notes:read"], ["health:read"], "chores:read"]) assert.throws(() => pluginConfiguration({ origin: "https://home.example.test", clientMode: "cimd", readScopes }));
});

test("each deployment uses its own resource and pre-registered public client without secrets or automatic registration", () => {
  for (const origin of ["https://hosted.example.test", "https://selfhost.example.test", "http://localhost:17180"]) {
    const config = pluginConfiguration({ origin, clientId: "synthetic-client" });
    const server = config.mcp.mcpServers["domi-ops"], auth = server.extensions["com.openai"].auth;
    assert.equal(server.url, origin + "/api/mcp"); assert.equal(auth.resource, server.url);
    assert.deepEqual(auth.client, { mode: "provided", clientId: "synthetic-client", tokenEndpointAuthMethod: "none" });
    assert.deepEqual(auth.defaultScopes, ["shopping:read", "chores:read", "notes:read", "offline_access"]);
    assert.equal(JSON.stringify(config).includes("clientSecret"), false);
  }
});
test("rejects noncanonical origins and unsupported credential methods", () => {
  for (const origin of ["http://external.example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?token=private", "file:///private"]) assert.throws(() => pluginConfiguration({ origin, clientId: "client" }));
  for (const clientId of ["", "private\nheader", "x".repeat(257)]) assert.throws(() => pluginConfiguration({ origin: "https://example.test", clientId }));
  assert.throws(() => pluginConfiguration({ origin: "https://example.test", clientId: "client", authMethod: "private_key_jwt" }));
});
test("registered connection packages reference one existing app without introducing another endpoint or OAuth client", async () => {
  const registeredAppId = "plugin_asdk_app_synthetic123";
  const config = pluginConfiguration({ registeredAppId });
  assert.deepEqual(config.apps, { apps: { "domi-ops": { id: "asdk_app_synthetic123", required: true } } });
  assert.deepEqual(pluginConfiguration({ registeredAppId: "asdk_app_synthetic123" }), config);
  assert.equal(config.plugin.extensions["com.openai"].apps, "./.app.json");
  assert.equal(config.mcp, undefined);
  for (const value of ["connector_other", "plugin_asdk_app_", "plugin_asdk_app_x/../y", "plugin_plugin_asdk_app_x", "asdk_app_-invalid", {}]) assert.throws(() => pluginConfiguration({ registeredAppId: value }));
  assert.throws(() => pluginConfiguration({ registeredAppId, origin: "https://example.test" }));
  const root = await mkdtemp(join(tmpdir(), "domi-mcp-package-")), output = join(root, "plugin");
  try {
    await writePlugin({ registeredAppId, output });
    assert.deepEqual((await readdir(output)).sort(), [".app.json", "plugin.json", "skills"]);
    assert.deepEqual(JSON.parse(await readFile(join(output, ".app.json"), "utf8")), config.apps);
    assert.deepEqual(await readFile(join(output, "skills/domi-ops-household-briefing/SKILL.md")), await readFile(new URL("../../skills/domi-ops-household-briefing/SKILL.md", import.meta.url)));
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-mcp-package-/);
    await rm(root, { recursive: true, force: true });
  }
});
test("copies the shared skill byte-for-byte and refuses to replace an existing package", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-mcp-package-")), output = join(root, "plugin");
  try {
    const options = { origin: "http://localhost:17180", clientId: "fixture", output };
    await writePlugin(options);
    const source = new URL("../../skills/domi-ops-household-briefing/SKILL.md", import.meta.url);
    assert.deepEqual(await readFile(join(output, "skills/domi-ops-household-briefing/SKILL.md")), await readFile(source));
    assert.deepEqual((await readdir(output)).sort(), ["mcp.json", "plugin.json", "skills"]);
    await assert.rejects(writePlugin(options), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-mcp-package-/);
    await rm(root, { recursive: true, force: true });
  }
});
