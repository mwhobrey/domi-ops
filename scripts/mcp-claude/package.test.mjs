import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { pluginConfiguration, writePlugin } from "./package.mjs";
import { prepareSubmission } from "./prepare-submission.mjs";

test("cloud packages reject local, credential-bearing and noncanonical resources", () => {
  for (const origin of ["http://localhost:18180", "https://localhost", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?token=secret", "file:///private",
    "https://10.0.0.1", "https://169.254.1.1", "https://192.168.1.1", "https://[fc00::1]", "https://[fe80::1]",
    "https://[::ffff:10.0.0.1]", "https://[::ffff:169.254.1.1]", "https://[0:0:0:0:0:ffff:7f00:1]"]) assert.throws(() => pluginConfiguration(origin));
  for (const origin of ["https://hosted.example.test", "https://selfhost.example.test"]) {
    const config = pluginConfiguration(origin);
    assert.deepEqual(config.mcp, { mcpServers: { "domi-ops": { type: "http", url: origin + "/api/mcp" } } });
    assert.equal(/clientSecret|Authorization|bearer|apiKey/i.test(JSON.stringify(config)), false);
  }
});

test("submission preparation retains release gates and refuses to replace review materials", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-claude-submission-")), output = join(root, "draft");
  try {
    const options = { origin: "https://hosted.example.test", output };
    const draft = await prepareSubmission(options);
    assert.equal(draft.readyToSubmit, false);
    assert.equal(draft.status, "draft-not-submitted");
    assert.equal(draft.serverUrl, options.origin + "/api/mcp");
    assert.deepEqual(draft.authentication, { requirement: "always-required", method: "oauth_cimd", secret: "not-required" });
    assert.ok(draft.requiredBeforeSubmit.some(gate => gate.includes("actual registration-free Claude acceptance")));
    assert.ok(draft.requiredBeforeSubmit.some(gate => gate.includes("integrations/claude/domi-ops-household") && gate.includes("GitHub source")));
    assert.deepEqual(JSON.parse(await readFile(join(output, "listing.draft.json"), "utf8")), draft);
    assert.deepEqual(await readFile(join(output, "icon.png")), await readFile(new URL("../../apps/web/public/icons/icon-512.png", import.meta.url)));
    assert.equal(/clientSecret|Authorization|bearer|apiKey/i.test(await readFile(join(output, "plugin/.mcp.json"), "utf8")), false);
    await assert.rejects(prepareSubmission(options), { code: "EEXIST" });
    assert.deepEqual(JSON.parse(await readFile(join(output, "listing.draft.json"), "utf8")), draft);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-submission-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude package preserves the shared skill and license and never replaces an existing package", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-claude-package-")), output = join(root, "fresh", "claude", "plugin");
  try {
    const options = { origin: "https://synthetic.example.test", output };
    await writePlugin(options);
    assert.deepEqual((await readdir(output)).sort(), [".claude-plugin", ".mcp.json", "README.md", "skills"]);
    const readme = await readFile(join(output, "README.md"), "utf8");
    assert.ok(readme.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length >= 40);
    assert.ok(readme.includes(options.origin + "/api/mcp"));
    assert.ok(readme.includes("It runs no local commands"));
    assert.ok(readme.includes("Disconnect in"));
    for (const name of ["SKILL.md", "LICENSE.txt"]) assert.deepEqual(await readFile(join(output, "skills/domi-ops-household-briefing", name)), await readFile(new URL("../../skills/domi-ops-household-briefing/" + name, import.meta.url)));
    await assert.rejects(writePlugin(options), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-package-/);
    await rm(root, { recursive: true, force: true });
  }
});
