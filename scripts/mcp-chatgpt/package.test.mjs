import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { pluginConfiguration, writePlugin } from "./package.mjs";

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
