import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nonPublicMcpHost } from "../hosted-qa/mcp-origin.mjs";
import { PILOT_SCOPES, privacyParagraph } from "../mcp-review/scopes.mjs";

export const PLUGIN_VERSION = "0.2.1";
export const PLUGIN_SKILLS = ["domi-ops-household-briefing", "domi-ops-household-actions"];

export function pluginConfiguration(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !["", "/"].includes(url.pathname) || nonPublicMcpHost(url.hostname)) throw new Error("Claude cloud connectors require a canonical public HTTPS origin");
  return {
    plugin: { name: "domi-ops-household", version: PLUGIN_VERSION, description: "Shared household chores and shopping, plus optional actions each member switches on.", author: { name: "Domi Ops" }, license: "MIT",
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const skillName of PLUGIN_SKILLS) {
    const skill = join(output, "skills", skillName);
    await mkdir(skill, { recursive: true });
    for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills", skillName, name), join(skill, name));
  }
  await mkdir(join(output, "assets"));
  await copyFile(join(root, "apps/web/public/icons/icon-512.png"), join(output, "assets/icon.png"));
  await writeFile(join(output, ".claude-plugin", "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  await writeFile(join(output, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
  await writeFile(join(output, "README.md"), `# Domi Ops household

Read persisted shared household chores and shopping items. Where the server's
operator offers it and you switch it on, Claude can also add a shopping item,
tell you when a medication group you shared is due, record that group as taken
when you say you took it, and tell you when you are busy on calendars you chose.
Ask for a household briefing, or say "add oat milk to the shopping list".

Two skills are included. The household briefing skill explains how to retrieve
bounded results, report missing coverage and link back to your records. The
household actions skill explains the few things Claude can do and how to report
them exactly.

## Install and connect

This package connects only to ${mcp.mcpServers["domi-ops"].url}. Install it through
Claude's supported plugin flow, then sign in to that Domi Ops server and review
the exact member, household and permissions before approving access. The
operator and household administrator must enable AI connections first. Do not
enter an API key, client secret or request header. A separate Claude account is
required. Standard integration is included in hosted pricing and free for
self-hosting; self-hosters generate a package for their own public HTTPS origin.

## What Claude can do, and who decides

Three things must all allow an ability: the server's operator offers it, you
approve it when you sign in, and you switch it on for this connection in
Domi Ops under Settings, AI Connections. Reading shopping and chores starts on
and can be unticked. Every other ability starts off. You can switch any of them
off again at any time, and it takes effect on Claude's next request.

Actions finish in chat: there is no second confirmation step in Domi Ops, though
Claude may ask you to confirm. They are limited to adding a shopping item and
recording a medication group as taken. Claude cannot edit, check off, remove,
skip, undo or delete anything, and cannot create calendar events. Domi Ops keeps
a list of what each assistant did, visible only to you.

## Permissions and privacy

The plugin declares one remote HTTPS MCP connector and two skills. It runs no
local commands, hooks or background programs. ${privacyParagraph(PILOT_SCOPES, "Claude")}
There is no planning-note, School, Drive or attachment access in this package.
Do not share copied Google-derived, health, child or excluded content.
Review Claude's privacy settings and terms before consenting. Disconnect in
Domi Ops AI Connections to stop future access; this cannot erase provider copies.

## Troubleshooting and support

If connection fails, confirm the server URL, HTTPS reachability and AI connection
settings, then check the permissions shown during sign-in. If Claude says an
ability is switched off, turn it on in Domi Ops AI Connections; if it is not
offered there, the server's operator has not enabled it. Stop on unexpected
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
