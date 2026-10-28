import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, basename, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pluginConfiguration, writePlugin } from "./package.mjs";

test("requires a canonical reachable-style HTTPS origin without credentials or private literal hosts", () => {
  for (const origin of ["http://example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test?key=canary",
    "https://example.test#fragment", "https://localhost", "https://10.0.0.1", "https://[::ffff:127.0.0.1]", "https://[fc00::1]"]) {
    assert.throws(() => pluginConfiguration(origin));
  }
  assert.equal(pluginConfiguration("https://selfhost.example.test/").mcp.mcpServers["domi-ops"].url, "https://selfhost.example.test/api/mcp");
});

test("packages only the remote connection and byte-identical shared skill; refuses overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-grok-package-"));
  try {
    const output = join(root, "new-package");
    await writePlugin({ origin: "https://selfhost.example.test", output });
    assert.deepEqual((await readdir(output)).sort(), [".cursor-plugin", "README.md", "assets", "mcp.json", "skills"]);
    const mcp = JSON.parse(await readFile(join(output, "mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers, { "domi-ops": { url: "https://selfhost.example.test/api/mcp",
      auth: { CLIENT_ID: "https://cursor.com/oauth/mcp-client.json", scopes: ["shopping:read", "chores:read", "offline_access"] } } });
    const manifest = JSON.parse(await readFile(join(output, ".cursor-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.logo, "assets/icon.png");
    assert.deepEqual(await readFile(join(output, manifest.logo)), await readFile(new URL("../../apps/web/public/icons/icon-512.png", import.meta.url)));
    for (const name of ["SKILL.md", "LICENSE.txt"]) {
      assert.deepEqual(await readFile(join(output, "skills/domi-ops-household-briefing", name)),
        await readFile(new URL("../../skills/domi-ops-household-briefing/" + name, import.meta.url)));
    }
    const original = await readFile(join(output, "mcp.json"));
    await assert.rejects(writePlugin({ origin: "https://other.example.test", output }), { code: "EEXIST" });
    assert.deepEqual(await readFile(join(output, "mcp.json")), original);
    const readme = await readFile(join(output, "README.md"), "utf8");
    assert.match(readme, /not proof of Grok Bot import/);
    assert.match(readme, /other Bots on the same account/);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-grok-package-/);
    await rm(root, { recursive: true, force: true });
  }
});
