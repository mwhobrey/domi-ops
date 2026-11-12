import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pluginConfiguration, writePlugin } from "./package.mjs";
import { writeReviewMaterials } from "../mcp-review/materials.mjs";
import { PILOT_SCOPES, hasActions, hasHealth, hasWrites } from "../mcp-review/scopes.mjs";

/**
 * `readScopes` is every scope the listing requests besides offline_access (the name is historical).
 * It defaults to the hosted update's set and must equal the submission endpoint's MCP_READ_SCOPES
 * plus the scopes its MCP_DIRECT_ACTIONS require.
 */
export async function prepareSubmission({ origin, output, readScopes = PILOT_SCOPES }) {
  const options = { origin, clientMode: "cimd", readScopes };
  const config = pluginConfiguration(options);
  const scopes = config.mcp.mcpServers["domi-ops"].extensions["com.openai"].auth.defaultScopes;
  const actions = hasActions(scopes);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const pluginPath = join(output, "plugin");
  await writePlugin({ ...options, output: pluginPath });
  await mkdir(join(pluginPath, "assets"));
  await copyFile(join(root, "apps/web/public/icons/icon-512.png"), join(pluginPath, "assets/icon.png"));
  const plugin = JSON.parse(await readFile(join(pluginPath, "plugin.json"), "utf8"));
  plugin.extensions = { "com.openai": { interface: {
    displayName: "Domi Ops", shortDescription: actions ? "Household lists and routines" : "Household briefing",
    longDescription: actions
      ? `${plugin.description} Each adult signs in to Domi Ops, approves their own access and switches on each ability for that connection; every action starts off. Medication names and event details are never shared. Nothing can edit, remove, skip or undo a record. No School, Drive or attachment access. Standard integration is included in hosted pricing and free for self-hosting; a separate ChatGPT account is required.`
      : `${plugin.description} Read persisted records with source links. Each adult signs in to Domi Ops and approves their own access. No saved changes or direct Calendar, School, Health, Drive or attachment access. Standard integration is included in hosted pricing and free for self-hosting; a separate ChatGPT account is required.`,
    developerName: "Domi Ops", category: "Productivity", logo: "./assets/icon.png", composerIcon: "./assets/icon.png",
    websiteURL: "https://domi-ops.com", supportURL: "https://github.com/mwhobrey/domi-ops/issues/new/choose",
    privacyPolicyURL: "https://domi-ops.com/privacy", termsOfServiceURL: "https://domi-ops.com/terms",
    defaultPrompt: [actions ? "Using only what I have approved and switched on in Domi Ops, give me a household briefing." : "Give me a household briefing using only my approved Domi Ops read permissions."]
  } } };
  await writeFile(join(pluginPath, "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  await copyFile(join(root, "docs/MCP_CHATGPT_SUBMISSION.md"), join(output, "submission-guide.md"));
  await writeReviewMaterials({ output, scopes, packageVersion: config.plugin.version });
  const draft = { status: "draft-not-uploaded", readyToSubmit: false, serverUrl: config.mcp.mcpServers["domi-ops"].url,
    scopes,
    dataHandling: { reads: true, writes: hasWrites(scopes), healthData: hasHealth(scopes) },
    requiredBeforeSubmit: [
      "Review merged source and authorize exact stable endpoint deployment",
      ...(actions ? [
        "Set the endpoint's MCP_READ_SCOPES and MCP_DIRECT_ACTIONS to exactly the scopes in this draft; a mismatch refuses sign-in",
        "Publish the updated privacy disclosure covering assistant actions" + (hasHealth(scopes) ? ", medication timing" : "") + (scopes.includes("calendar:read") ? " and calendar availability" : ""),
        "Record the confirmation ChatGPT shows for each tool that is not read-only",
      ] : []),
      "Verify native ChatGPT identity and managed JWKS reachability",
      "Record actual registration-free ChatGPT acceptance and paired Claude checks",
      "Confirm verified publisher organization/project, listing fields and current public URLs",
      "Prepare isolated populated fictional reviewer account and private review credentials",
      "Prepare and run exactly five positive test cases with the fictional reviewer account, including scenario, prompt, expected tools and result",
      "Prepare and run exactly three negative test cases, including prompt or scenario, reason not to act and expected refusal, clarification or safe fallback",
      "Provide an accessible video walkthrough URL demonstrating the review test cases and plugin functionality",
      "Prepare release notes identifying the submitted package version and changes",
      "Package plugin contents at ZIP root and inspect for private material",
      "Authorize upload, domain challenge and scan with fictional data",
      "Review scan results, terms and final submission"
    ] };
  await writeFile(join(output, "listing.draft.json"), JSON.stringify(draft, null, 2) + "\n");
  return draft;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, output, scopeArg, ...extra] = process.argv.slice(2);
  if (!origin || !output || extra.length) throw new Error("Usage: node scripts/mcp-chatgpt/prepare-submission.mjs CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY [SCOPES_CSV]");
  await prepareSubmission({ origin, output: resolve(output), ...(scopeArg === undefined ? {} : { readScopes: scopeArg.split(",").map(scope => scope.trim()) }) });
  console.log("Prepared credential-free OpenAI submission draft; no upload, grant or live acceptance claimed.");
}
