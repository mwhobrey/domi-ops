import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pluginConfiguration, writePlugin } from "./package.mjs";

export async function prepareSubmission({ origin, output }) {
  const { mcp } = pluginConfiguration(origin);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  await writePlugin({ origin, output: join(output, "plugin") });
  await copyFile(join(root, "apps/web/public/icons/icon-512.png"), join(output, "icon.png"));
  await copyFile(join(root, "docs/MCP_CLAUDE_SUBMISSION.md"), join(output, "submission-guide.md"));
  const draft = {
    status: "draft-not-submitted", readyToSubmit: false,
    name: "Domi Ops", suggestedSlug: "domi-ops", serverUrl: mcp.mcpServers["domi-ops"].url,
    oneLiner: "Read household chores, shopping lists and planning notes you explicitly choose to share.",
    description: "Bring your household's persisted shopping items, chores and selected planning notes into Claude. Each adult signs in to Domi Ops and approves their own access. Ask for a household briefing or shopping check-in with links back to your records. Read-only: no saved changes, Calendar, School, Health, Drive or attachments. Standard integration is included in the hosted plan and free for self-hosting; a separate Claude account is required. Disconnect future access in Domi Ops AI connections.",
    company: { name: "Domi Ops", website: "https://domi-ops.com" },
    documentationUrl: "https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_CLAUDE.md",
    privacyPolicyUrl: "https://domi-ops.com/privacy",
    supportUrl: "https://github.com/mwhobrey/domi-ops/issues/new/choose",
    authentication: { requirement: "always-required", method: "oauth_cimd", secret: "not-required" },
    dataHandling: { apiOwnership: "first-party", reads: true, writes: false, healthData: false, sponsoredContent: false },
    requiredBeforeSubmit: ["Confirm submitting account/organization and review contact", "Deploy reviewed build to approved stable endpoint and enable Claude", "Verify current public documentation/privacy pages", "Provision a populated fictional reviewer account; keep its credentials private", "Record actual registration-free Claude acceptance and tool checks on submitted endpoint", "Commit and push the reviewed plugin to integrations/claude/domi-ops-household through a release PR, then validate that GitHub source in the portal", "Approve listing fields, directory terms and final submission"],
  };
  await writeFile(join(output, "listing.draft.json"), JSON.stringify(draft, null, 2) + "\n");
  return draft;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, output, ...extra] = process.argv.slice(2);
  if (!origin || !output || extra.length) throw new Error("Usage: node scripts/mcp-claude/prepare-submission.mjs CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY");
  await prepareSubmission({ origin, output: resolve(output) });
  console.log("Claude submission draft, icon and plugin prepared. No network requests or publication; live readiness remains unchecked.");
}
