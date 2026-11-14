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
    // The read-only profile is still available by naming its scopes.
    const options = { origin: "https://hosted.example.test", output, scopes: ["shopping:read", "chores:read"] };
    const draft = await prepareSubmission(options);
    assert.deepEqual(draft.dataHandling, { apiOwnership: "first-party", reads: true, writes: false, healthData: false, sponsoredContent: false });
    assert.equal(draft.readyToSubmit, false);
    assert.equal(draft.status, "draft-not-submitted");
    assert.equal(draft.serverUrl, options.origin + "/api/mcp");
    assert.doesNotMatch(draft.oneLiner + " " + draft.description, /notes/i);
    const manifest = JSON.parse(await readFile(join(output, "plugin/.claude-plugin/plugin.json"), "utf8"));
    assert.doesNotMatch(manifest.description, /notes/i);
    const readme = await readFile(join(output, "plugin/README.md"), "utf8");
    assert.ok(readme.includes("shared household chores and shopping items"));
    assert.ok(readme.includes("no planning-note"));
    assert.ok(readme.includes("Every other ability starts off"));
    const review = JSON.parse(await readFile(join(output, "review-plan.draft.json"), "utf8"));
    assert.deepEqual(review.scopes, ["shopping:read", "chores:read", "offline_access"]);
    assert.equal(review.execution.status, "not-run");
    assert.equal(review.review.test_cases.positive.length, 5);
    assert.equal(review.review.test_cases.negative.length, 3);
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
    assert.deepEqual((await readdir(output)).sort(), [".claude-plugin", ".mcp.json", "README.md", "assets", "skills"]);
    const manifest = JSON.parse(await readFile(join(output, ".claude-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.privacyPolicyUrl, "https://domi-ops.com/privacy");
    assert.deepEqual(await readFile(join(output, manifest.icon)), await readFile(new URL("../../apps/web/public/icons/icon-512.png", import.meta.url)));
    const readme = await readFile(join(output, "README.md"), "utf8");
    assert.ok(readme.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length >= 40);
    assert.ok(readme.includes(options.origin + "/api/mcp"));
    assert.ok(readme.replace(/\s+/g, " ").includes("It runs no local commands"));
    assert.ok(readme.includes("Disconnect in"));
    assert.deepEqual((await readdir(join(output, "skills"))).sort(), ["domi-ops-household-actions", "domi-ops-household-briefing"]);
    for (const skill of ["domi-ops-household-briefing", "domi-ops-household-actions"]) for (const name of ["SKILL.md", "LICENSE.txt"]) {
      assert.deepEqual(await readFile(join(output, "skills", skill, name)), await readFile(new URL(`../../skills/${skill}/${name}`, import.meta.url)));
    }
    assert.equal(manifest.version, "0.2.1");
    assert.doesNotMatch(manifest.description, /read-only/i);
    // The README names every limit a reviewer or member needs before switching an action on.
    for (const phrase of ["Medication name, strength, instruction and history fields are never sent, but the label is sent as you wrote it", "Event titles, locations, people and calendar names are never sent",
      "cannot edit, check off, remove,", "switch it on for this connection", "events imported from Google Calendar are left out"]) assert.ok(readme.includes(phrase), phrase);
    await assert.rejects(writePlugin(options), { code: "EEXIST" });
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-package-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("prepared portal source stays in sync with the credential-free hosted package", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-claude-package-")), output = join(root, "plugin");
  try {
    await writePlugin({ origin: "https://app.domi-ops.com", output });
    for (const file of [".claude-plugin/plugin.json", ".mcp.json", "README.md", "assets/icon.png", "skills/domi-ops-household-briefing/SKILL.md", "skills/domi-ops-household-briefing/LICENSE.txt",
      "skills/domi-ops-household-actions/SKILL.md", "skills/domi-ops-household-actions/LICENSE.txt"]) {
      assert.deepEqual(await readFile(join(output, file)), await readFile(new URL("../../integrations/claude/domi-ops-household/" + file, import.meta.url)), `Prepared source drift: ${file}`);
    }
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-package-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("the default submission is the assistant-actions update and says what it shares", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-claude-submission-")), output = join(root, "draft");
  try {
    const draft = await prepareSubmission({ origin: "https://hosted.example.test", output });
    assert.equal(draft.readyToSubmit, false);
    assert.deepEqual(draft.scopes, ["shopping:read", "chores:read", "shopping:write", "health:read", "health:write", "calendar:read", "offline_access"]);
    assert.deepEqual(draft.dataHandling, { apiOwnership: "first-party", reads: true, writes: true, healthData: true, sponsoredContent: false });
    assert.doesNotMatch(draft.oneLiner + " " + draft.description, /read-only|notes/i);
    assert.match(draft.description, /a group's label is sent as the member wrote it/);
    assert.match(draft.description, /Event titles, locations, people and calendar names are never sent/);
    for (const gate of ["MCP_READ_SCOPES and MCP_DIRECT_ACTIONS", "privacy disclosure covering assistant actions, medication timing and calendar availability", "provider-side confirmation prompt"]) {
      assert.ok(draft.requiredBeforeSubmit.some(entry => entry.includes(gate)), gate);
    }
    const review = JSON.parse(await readFile(join(output, "review-plan.draft.json"), "utf8"));
    assert.equal(review.packageVersion, "0.2.1");
    assert.equal(review.review.test_cases.positive.length, 5);
    assert.equal(review.review.test_cases.negative.length, 3);
    const tools = review.review.test_cases.positive.map(c => c.tools_triggered).join(",");
    for (const tool of ["add_shopping_item", "get_medication_group_schedule", "log_medication_group", "get_calendar_availability", "list_shopping_items", "list_chores"]) assert.ok(tools.includes(tool), tool);
    assert.equal(tools.includes("get_selected_note"), false);
    assert.equal(review.execution.status, "not-run");
    assert.match(await readFile(join(output, "release-notes.draft.md"), "utf8"), /Two tools are not read-only/);
    for (const scopes of [[], ["health:write"], ["shopping:write"], ["shopping:read", "drive:read"], ["shopping:read", "shopping:read"]]) {
      await assert.rejects(prepareSubmission({ origin: "https://hosted.example.test", output: join(root, "bad" + scopes.length + scopes.join("")), scopes }));
    }
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-submission-/);
    await rm(root, { recursive: true, force: true });
  }
});

test("a narrower Claude draft discloses only what it requests, and never requests notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "domi-claude-submission-"));
  try {
    for (const scopes of [["shopping:read", "notes:read"], ["notes:read"], ["shopping:read", "chores:read", "notes:read", "shopping:write"]]) {
      await assert.rejects(prepareSubmission({ origin: "https://hosted.example.test", output: join(root, "refused"), scopes }));
    }
    const draft = await prepareSubmission({ origin: "https://hosted.example.test", output: join(root, "add"), scopes: ["shopping:read", "shopping:write"] });
    assert.equal(draft.dataHandling.healthData, false);
    assert.doesNotMatch(draft.description, /medication|label|calendar|Event titles/i);
    assert.match(draft.description, /Reading shopping starts on; everything else starts off\. It cannot edit/);
    const calendar = await prepareSubmission({ origin: "https://hosted.example.test", output: join(root, "calendar"), scopes: ["shopping:read", "calendar:read"] });
    assert.match(calendar.description, /Event titles, locations, people and calendar names are never sent/);
    assert.doesNotMatch(calendar.description, /medication|label/i);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.match(basename(root), /^domi-claude-submission-/);
    await rm(root, { recursive: true, force: true });
  }
});
