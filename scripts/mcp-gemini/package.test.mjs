import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { writeSkill } from "./package.mjs";

test("Gemini import contains only the unchanged portable skill and license and refuses replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-gemini-package-")), output = join(root, "skill");
  try {
    await writeSkill({ output });
    assert.deepEqual((await readdir(output)).sort(), ["LICENSE.txt", "SKILL.md"]);
    for (const name of ["SKILL.md", "LICENSE.txt"]) assert.deepEqual(await readFile(join(output, name)), await readFile(new URL("../../skills/domi-ops-household-briefing/" + name, import.meta.url)));
    await assert.rejects(writeSkill({ output }), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-gemini-package-/);
    await rm(root, { recursive: true, force: true });
  }
});
