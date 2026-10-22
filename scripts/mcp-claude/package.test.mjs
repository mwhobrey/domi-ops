import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { pluginConfiguration, writePlugin } from "./package.mjs";

test("cloud packages reject local, credential-bearing and noncanonical resources", () => {
  for (const origin of ["http://localhost:18180", "https://localhost", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?token=secret", "file:///private"]) assert.throws(() => pluginConfiguration(origin));
  for (const origin of ["https://hosted.example.test", "https://selfhost.example.test"]) {
    const config = pluginConfiguration(origin);
    assert.deepEqual(config.mcp, { mcpServers: { "domi-ops": { type: "http", url: origin + "/api/mcp" } } });
    assert.equal(/clientSecret|Authorization|bearer|apiKey/i.test(JSON.stringify(config)), false);
  }
});

test("Claude package preserves the shared skill and license and never replaces an existing package", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-claude-package-")), output = join(root, "plugin");
  try {
    const options = { origin: "https://synthetic.example.test", output };
    await writePlugin(options);
    assert.deepEqual((await readdir(output)).sort(), [".claude-plugin", ".mcp.json", "skills"]);
    for (const name of ["SKILL.md", "LICENSE.txt"]) assert.deepEqual(await readFile(join(output, "skills/domi-ops-household-briefing", name)), await readFile(new URL("../../skills/domi-ops-household-briefing/" + name, import.meta.url)));
    await assert.rejects(writePlugin(options), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-package-/);
    await rm(root, { recursive: true, force: true });
  }
});
