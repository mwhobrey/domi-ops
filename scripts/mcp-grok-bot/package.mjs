import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nonPublicMcpHost } from "../hosted-qa/mcp-origin.mjs";
import { PILOT_SCOPES, checkPackageScopes, privacyParagraph, scopeSummary, skillNames } from "../mcp-review/scopes.mjs";

/** What Grok Bot's policy on the server accepts: everything the other providers may hold except selected notes. */
export const GROK_BOT_SCOPES = [...PILOT_SCOPES];
export const PLUGIN_VERSION = "0.2.1";
const domainNames = (scopes) => scopes.filter(scope => ["shopping:read", "chores:read"].includes(scope)).map(scope => scope === "shopping:read" ? "shopping" : "chores").join(" and ");
/** Medication or calendar access: the package then describes itself by what the member can switch on. */
const isWide = (scopes) => scopes.some(scope => scope.startsWith("health:") || scope.startsWith("calendar:"));
const optional = (scopes) => scopes.filter(scope => !["shopping:read", "chores:read", "offline_access"].includes(scope));

/** `readScopes` names every requested scope besides offline_access; the name predates shopping:write. */
export function pluginConfiguration(origin, readScopes = ["shopping:read", "chores:read"]) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || nonPublicMcpHost(url.hostname)) throw new Error("Canonical public HTTPS origin required");
  try { checkPackageScopes(readScopes, GROK_BOT_SCOPES); }
  catch { throw new Error("Deployment scopes required from: " + GROK_BOT_SCOPES.join(",") + " (an action needs its read)"); }
  const add = readScopes.includes("shopping:write"), wide = isWide(readScopes);
  return {
    plugin: { name: "domi-ops-household", displayName: "Domi Ops", author: { name: "MikeWhob" },
      version: PLUGIN_VERSION, description: wide ? `Household access you switch on: ${scopeSummary(readScopes)}.` : add ? `Shared household ${domainNames(readScopes)} with a source-linked briefing, plus adding shopping items once you switch it on.` : `Read-only shared household ${domainNames(readScopes)} with a source-linked briefing.`,
      license: "MIT", homepage: "https://domi-ops.com", logo: "assets/icon.png" },
    mcp: { mcpServers: { "domi-ops": { url: url.origin + "/api/mcp",
      auth: { CLIENT_ID: "https://cursor.com/oauth/mcp-client.json", scopes: [...readScopes, "offline_access"] } } } },
  };
}

export async function writePlugin({ origin, output, readScopes }) {
  const config = pluginConfiguration(origin, readScopes);
  const requestedScopes = config.mcp.mcpServers["domi-ops"].auth.scopes;
  const domains = domainNames(requestedScopes), add = requestedScopes.includes("shopping:write"), wide = isWide(requestedScopes);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const skills = skillNames(requestedScopes);
  for (const skillName of skills) {
    const skill = join(output, "skills", skillName);
    await mkdir(skill, { recursive: true });
    for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills", skillName, name), join(skill, name));
  }
  await mkdir(join(output, ".cursor-plugin"));
  await mkdir(join(output, "assets"));
  await copyFile(join(root, "apps/web/public/icons/icon-512.png"), join(output, "assets/icon.png"));
  await writeFile(join(output, ".cursor-plugin/plugin.json"), JSON.stringify(config.plugin, null, 2) + "\n");
  await writeFile(join(output, "mcp.json"), JSON.stringify(config.mcp, null, 2) + "\n");
  await writeFile(join(output, "README.md"), `# Domi Ops household ${wide ? "briefing and actions" : add ? "briefing and shopping add" : "briefing"} for Grok Bot

This draft contains one remote MCP endpoint (${config.mcp.mcpServers["domi-ops"].url})
and ${add || wide ? "the shared briefing skill and the household actions skill, each" : "the unchanged shared briefing skill"} with its MIT license. It contains no
secrets, local commands, hooks, agents or scheduled routines. Its public OAuth
client identity is https://cursor.com/oauth/mcp-client.json and its explicit
requested scopes are ${requestedScopes.join(", ")}. These must match what the
deployment advertises plus offline_access; either read domain may be enabled alone. The client
ID is a public identity URL, not a secret or API key.

## Release status

Package generation is not proof of Grok Bot import, OAuth or live tool acceptance.
Grok Bot's observed private workflow does not offer ZIP import: add the remote
connection and save ${add || wide ? "each skill" : "the shared skill"} separately for private testing. This Cursor
format is a marketplace draft, not proof of an installable private ZIP.
Verify the installed experience before publishing. Ordinary Grok chat, Grok Build/CLI,
Cursor desktop and the model API are separate surfaces; no support is implied.

## Connect and review

The operator must explicitly enable the Grok Bot integration and a deployment
scope ceiling that matches this package. A household administrator enables AI connections; each
eligible adult then signs in to Domi Ops and personally reviews their own grant.
The grant permits shared household ${domains} and refresh access. Chore access
includes other members' assigned chores. ${wide
  ? `It also offers further abilities, each of which starts off until the operator
offers it and the member switches it on for this connection in Domi Ops AI
Connections: ${scopeSummary(optional(requestedScopes))}.
${privacyParagraph(optional(requestedScopes), "Grok Bot")}
An action finishes in chat with no second confirmation in Domi Ops. The Bot
cannot edit, remove, skip or undo anything, and the grant does not include notes.`
  : add
  ? `It also lets the Bot add a shopping item, but only after the operator offers
that action and the member switches it on for this connection in Domi Ops AI
Connections; it starts off. Adding finishes in chat with no second confirmation
in Domi Ops, and everyone in the household sees the item and that an assistant
added it. The Bot cannot edit, check off or remove an item. It does not permit
notes, medication, calendar or any other change.`
  : "It does not permit notes or domain writes."}
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
The connector's permissions do not restrict unrelated browser sessions
or other tools available to a Bot.

[Setup](https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_GROK_BOT.md) ·
[Privacy](https://domi-ops.com/privacy) ·
[Support](https://github.com/mwhobrey/domi-ops/issues/new/choose)
`);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, output, readScopeArg, ...extra] = process.argv.slice(2);
  if (!origin || !output || extra.length) throw new Error("Usage: node scripts/mcp-grok-bot/package.mjs CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY [DEPLOYMENT_SCOPES_CSV]");
  await writePlugin({ origin, output: resolve(output), readScopes: readScopeArg === undefined ? undefined : readScopeArg.split(",").map(scope => scope.trim()) });
  console.log("Draft generated without credentials. Grok Bot import, connection and marketplace approval remain separate checks.");
}
