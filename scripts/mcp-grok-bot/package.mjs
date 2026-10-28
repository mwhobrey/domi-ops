import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nonPublicMcpHost } from "../hosted-qa/mcp-origin.mjs";

export function pluginConfiguration(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || nonPublicMcpHost(url.hostname)) throw new Error("Canonical public HTTPS origin required");
  return {
    plugin: { name: "domi-ops-household", displayName: "Domi Ops", author: { name: "MikeWhob" },
      version: "0.1.0", description: "Read-only shared household shopping and chores with a source-linked briefing.",
      license: "MIT", homepage: "https://domi-ops.com", logo: "assets/icon.png" },
    mcp: { mcpServers: { "domi-ops": { url: url.origin + "/api/mcp",
      auth: { CLIENT_ID: "https://cursor.com/oauth/mcp-client.json", scopes: ["shopping:read", "chores:read", "offline_access"] } } } },
  };
}

export async function writePlugin({ origin, output }) {
  const config = pluginConfiguration(origin);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const skill = join(output, "skills", "domi-ops-household-briefing");
  await mkdir(skill, { recursive: true });
  await mkdir(join(output, ".cursor-plugin"));
  await mkdir(join(output, "assets"));
  await copyFile(join(root, "apps/web/public/icons/icon-512.png"), join(output, "assets/icon.png"));
  for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills/domi-ops-household-briefing", name), join(skill, name));
  await writeFile(join(output, ".cursor-plugin/plugin.json"), JSON.stringify(config.plugin, null, 2) + "\n");
  await writeFile(join(output, "mcp.json"), JSON.stringify(config.mcp, null, 2) + "\n");
  await writeFile(join(output, "README.md"), `# Domi Ops household briefing for Grok Bot

This draft contains one remote MCP endpoint (${config.mcp.mcpServers["domi-ops"].url})
and the unchanged shared briefing skill with its MIT license. It contains no
secrets, local commands, hooks, agents or scheduled routines. Its public OAuth
client identity is https://cursor.com/oauth/mcp-client.json and its explicit
requested scopes are shopping:read, chores:read and offline_access. The client
ID is a public identity URL, not a secret or API key.

## Release status

Package generation is not proof of Grok Bot import, OAuth or live tool acceptance.
Grok Bot's observed private workflow does not offer ZIP import: add the remote
connection and save the shared skill separately for private testing. This Cursor
format is a marketplace draft, not proof of an installable private ZIP.
Verify the installed experience before publishing. Ordinary Grok chat, Grok Build/CLI,
Cursor desktop and the model API are separate surfaces; no support is implied.

## Connect and review

The operator must explicitly enable the Grok Bot integration and a shopping/chores-only
deployment read ceiling. A household administrator enables AI connections; each
eligible adult then signs in to Domi Ops and personally reviews their own grant.
The grant permits shared household shopping and chores, including other members'
assigned chores, and refresh access. It does not permit notes or domain writes.
Do not enter a client secret, API key or request header, or give the Bot a normal
browser login to the household app. Unexpected permissions are a reason to stop.

The OAuth identity is shared with Cursor cloud. Grok Bot's app connections can be
available to other Bots on the same account. Review the applicable Cursor privacy
and training settings before consent; cloud storage is required. Disconnect in
Domi Ops AI Connections to stop future MCP access; this cannot erase provider copies.

Standard integration is included in hosted pricing and free for self-hosting.
Customers provide their own eligible assistant account. Hosted uses the canonical
hosted endpoint; self-hosters generate this package for their own reachable HTTPS
origin. No cloud broker or public access to the database is required.

Ask for a household briefing using the approved connection. Missing data must be
reported, source links preserved and planning kept separate from saved changes.
The connector's read-only permissions do not restrict unrelated browser sessions
or other tools available to a Bot.

[Setup](https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_GROK_BOT.md) ·
[Privacy](https://domi-ops.com/privacy) ·
[Support](https://github.com/mwhobrey/domi-ops/issues/new/choose)
`);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, output, ...extra] = process.argv.slice(2);
  if (!origin || !output || extra.length) throw new Error("Usage: node scripts/mcp-grok-bot/package.mjs CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY");
  await writePlugin({ origin, output: resolve(output) });
  console.log("Draft generated without credentials. Grok Bot import, connection and marketplace approval remain separate checks.");
}
