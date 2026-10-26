import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nonPublicMcpHost } from "../hosted-qa/mcp-origin.mjs";

export function pluginConfiguration(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !["", "/"].includes(url.pathname) || nonPublicMcpHost(url.hostname)) throw new Error("Claude cloud connectors require a canonical public HTTPS origin");
  return {
    plugin: { name: "domi-ops-household", version: "0.1.1", description: "Read-only household chores, shopping and explicitly selected planning notes.", author: { name: "Domi Ops" }, license: "MIT",
      icon: "./assets/icon.png", documentationUrl: "https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_CLAUDE.md",
      supportUrl: "https://github.com/mwhobrey/domi-ops/issues/new/choose", privacyPolicyUrl: "https://domi-ops.com/privacy", termsOfServiceUrl: "https://domi-ops.com/terms" },
    mcp: { mcpServers: { "domi-ops": { type: "http", url: url.origin + "/api/mcp" } } },
  };
}

export async function writePlugin({ origin, output }) {
  const { plugin, mcp } = pluginConfiguration(origin);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  await mkdir(join(output, ".claude-plugin"));
  const skill = join(output, "skills", "domi-ops-household-briefing");
  await mkdir(skill, { recursive: true });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  await mkdir(join(output, "assets"));
  await copyFile(join(root, "apps/web/public/icons/icon-512.png"), join(output, "assets/icon.png"));
  for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills", "domi-ops-household-briefing", name), join(skill, name));
  await writeFile(join(output, ".claude-plugin", "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  await writeFile(join(output, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
  await writeFile(join(output, "README.md"), `# Domi Ops household briefing

Read your household's persisted chores, shopping items and planning notes you
explicitly select. Ask Claude for a household briefing or a shopping-and-chores
check-in. The shared briefing skill explains how to retrieve bounded results,
report missing coverage and link back to your records. It cannot save changes.

## Install and connect

This package connects only to ${mcp.mcpServers["domi-ops"].url}. Install it through
Claude's supported plugin flow, then sign in to that Domi Ops server and review
the exact member, household and permissions before approving access. The
operator and household administrator must enable AI connections first. Do not
enter an API key, client secret or request header. A separate Claude account is
required. Standard integration is included in hosted pricing and free for
self-hosting; self-hosters generate a package for their own public HTTPS origin.

## Permissions and privacy

The plugin declares one remote HTTPS MCP connector and the household briefing
skill. It runs no local commands, hooks or background programs. Approved reads
send household labels/timezone, chores, shopping items and selected planning
notes to Claude. It has no direct Calendar, School, Health, Drive or attachment
access. Do not select copied Google-derived, health, child or excluded content.
Review Claude's privacy settings and terms before consenting. Disconnect in
Domi Ops AI Connections to stop future reads; this cannot erase provider copies.

## Troubleshooting and support

If connection fails, confirm the server URL, HTTPS reachability and AI connection
settings, then check the permissions shown during sign-in. Stop on unexpected
permissions; do not share login sessions or disable authentication.
See [setup](https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_CLAUDE.md),
[privacy](https://domi-ops.com/privacy) and
[support](https://github.com/mwhobrey/domi-ops/issues/new/choose).
This MIT-licensed package does not establish directory approval or live service
availability by itself.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, output, ...extra] = process.argv.slice(2);
  if (!origin || !output || extra.length) throw new Error("Usage: node scripts/mcp-claude/package.mjs CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY");
  await writePlugin({ origin, output: resolve(output) });
  console.log("Claude package created without credentials. Connect using the deployment's reviewed onboarding; package creation does not establish live connectivity or directory approval.");
}
