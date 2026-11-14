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

test("restricts generated OAuth requests to the selected deployment read scopes", async () => {
  for (const scopes of [[], ["notes:read"], ["shopping:write"], ["offline_access"], ["shopping:read", "shopping:read"], "shopping:read"]) {
    assert.throws(() => pluginConfiguration("https://selfhost.example.test", scopes));
  }
  const root = await mkdtemp(join(tmpdir(), "domi-grok-scopes-"));
  try {
    for (const scope of ["shopping:read", "chores:read"]) {
      const output = join(root, scope.split(":")[0]);
      await writePlugin({ origin: "https://selfhost.example.test", output, readScopes: [scope] });
      const mcp = JSON.parse(await readFile(join(output, "mcp.json"), "utf8"));
      assert.deepEqual(mcp.mcpServers["domi-ops"].auth.scopes, [scope, "offline_access"]);
      const readme = await readFile(join(output, "README.md"), "utf8");
      assert.match(readme, new RegExp(`requested scopes are ${scope}, offline_access`));
      assert.equal(readme.includes(scope === "shopping:read" ? "chores:read" : "shopping:read"), false);
    }
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-grok-scopes-/);
    await rm(root, { recursive: true, force: true });
  }
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

test("requests shopping add only on top of the shopping read, and ships the actions skill with it", async () => {
  for (const scopes of [["chores:read", "shopping:write"], ["shopping:read", "health:write"], ["shopping:read", "notes:read"], ["health:write"]]) {
    assert.throws(() => pluginConfiguration("https://selfhost.example.test", scopes));
  }
  const root = await mkdtemp(join(tmpdir(), "domi-grok-scopes-"));
  try {
    const output = join(root, "add");
    await writePlugin({ origin: "https://selfhost.example.test", output, readScopes: ["shopping:read", "chores:read", "shopping:write"] });
    const mcp = JSON.parse(await readFile(join(output, "mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers["domi-ops"].auth.scopes, ["shopping:read", "chores:read", "shopping:write", "offline_access"]);
    const manifest = JSON.parse(await readFile(join(output, ".cursor-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.version, "0.2.1");
    assert.doesNotMatch(manifest.description, /read-only/i);
    assert.deepEqual((await readdir(join(output, "skills"))).sort(), ["domi-ops-household-actions", "domi-ops-household-briefing"]);
    for (const name of ["SKILL.md", "LICENSE.txt"]) {
      assert.deepEqual(await readFile(join(output, "skills/domi-ops-household-actions", name)), await readFile(new URL("../../skills/domi-ops-household-actions/" + name, import.meta.url)));
    }
    const readme = await readFile(join(output, "README.md"), "utf8");
    assert.match(readme, /it starts off/);
    assert.match(readme, /cannot edit, check off or remove an item/);
    assert.match(readme, /notes, medication, calendar or any other change/);
    // A read-only package still carries the briefing skill alone and makes no action claim.
    const plain = join(root, "plain");
    await writePlugin({ origin: "https://selfhost.example.test", output: plain });
    assert.deepEqual(await readdir(join(plain, "skills")), ["domi-ops-household-briefing"]);
    assert.match(await readFile(join(plain, "README.md"), "utf8"), /It does not permit notes or domain writes\./);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-grok-scopes-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts the full assistant-actions set and says what medication and calendar access share", async () => {
  const full = ["shopping:read", "chores:read", "shopping:write", "health:read", "health:write", "calendar:read"];
  const root = await mkdtemp(join(tmpdir(), "domi-grok-scopes-"));
  try {
    const output = join(root, "full");
    await writePlugin({ origin: "https://selfhost.example.test", output, readScopes: full });
    const mcp = JSON.parse(await readFile(join(output, "mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers["domi-ops"].auth.scopes, [...full, "offline_access"]);
    const manifest = JSON.parse(await readFile(join(output, ".cursor-plugin/plugin.json"), "utf8"));
    assert.match(manifest.description, /medication group times and logging status/);
    assert.match(manifest.description, /busy times on chosen calendars/);
    assert.doesNotMatch(manifest.description, /read-only/i);
    assert.deepEqual((await readdir(join(output, "skills"))).sort(), ["domi-ops-household-actions", "domi-ops-household-briefing"]);
    const readme = (await readFile(join(output, "README.md"), "utf8")).replace(/\s+/g, " ");
    assert.match(readme, /briefing and actions for Grok Bot/);
    assert.match(readme, /each of which starts off/);
    assert.match(readme, /Medication name, strength, instruction and history fields are never sent, but the label is sent as you wrote it/);
    assert.match(readme, /Event titles, locations, people and calendar names are never sent/);
    assert.match(readme, /cannot edit, remove, skip or undo anything, and the grant does not include notes/);
    assert.doesNotMatch(readme, /medication, calendar or any other change/);
    // Calendar alone, without any write, is still an action package.
    const calendar = join(root, "calendar");
    await writePlugin({ origin: "https://selfhost.example.test", output: calendar, readScopes: ["shopping:read", "calendar:read"] });
    assert.deepEqual((await readdir(join(calendar, "skills"))).sort(), ["domi-ops-household-actions", "domi-ops-household-briefing"]);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-grok-scopes-/);
    await rm(root, { recursive: true, force: true });
  }
});
