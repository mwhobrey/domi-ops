import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nonPublicMcpHost } from "../hosted-qa/mcp-origin.mjs";
import { checkPackageScopes, hasActions, privacyParagraph, readsOnSentence, scopeSummary, skillNames } from "../mcp-review/scopes.mjs";

export const PLUGIN_VERSION = "0.2.0";
/** Kept under its earlier name for callers that describe a read-only package. */
export function readScopeSummary(scopes) { return scopeSummary(scopes); }
const describe = (scopes) => hasActions(scopes) ? `Household access you switch on: ${scopeSummary(scopes)}.` : `Read-only access to ${scopeSummary(scopes)}.`;

/**
 * `readScopes` names every scope a published-identity package requests besides offline_access.
 * The name is historical: it may now include shopping:write, health:read, health:write and
 * calendar:read. It must equal what the target deployment advertises, or sign-in is refused.
 */
export function pluginConfiguration({ origin, clientId, authMethod = "none", registeredAppId, clientMode = "provided", readScopes }) {
  if (registeredAppId !== undefined) {
    if (origin !== undefined || clientId !== undefined || clientMode !== "provided" || readScopes !== undefined || typeof registeredAppId !== "string" || !/^(?:plugin_)?asdk_app_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(registeredAppId)) throw new Error("One registered ChatGPT MCP plugin ID required; endpoint/client options cannot be combined");
    // ChatGPT URLs use plugin_asdk_app_..., but .app.json requires the server's asdk_app_... ID.
    const appId = registeredAppId.replace(/^plugin_/, "");
    return {
      plugin: { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "domi-ops-household", version: PLUGIN_VERSION, description: "Household chores, shopping and the abilities each member switches on in Domi Ops.", license: "MIT", extensions: { "com.openai": { apps: "./.app.json" } } },
      apps: { apps: { "domi-ops": { id: appId, required: true } } },
    };
  }
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("Canonical HTTPS or local loopback origin required");
  if (!["provided", "cimd"].includes(clientMode)) throw new Error("Unsupported client mode");
  if (clientMode === "cimd") {
    if (clientId !== undefined || authMethod !== "none" || url.protocol !== "https:" || nonPublicMcpHost(url.hostname)) throw new Error("CIMD requires public HTTPS without client credentials");
    if (readScopes !== undefined) checkPackageScopes(readScopes);
  } else if (readScopes !== undefined || typeof clientId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/.test(clientId)) throw new Error("Registered public client ID required");
  if (!["none", "client_secret_basic", "client_secret_post"].includes(authMethod)) throw new Error("Unsupported token authentication method");
  const scopes = clientMode === "cimd" ? [...(readScopes ?? ["shopping:read", "chores:read"]), "offline_access"] : ["shopping:read", "chores:read", "notes:read", "offline_access"];
  return {
    plugin: { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "domi-ops-household", version: PLUGIN_VERSION, description: describe(scopes), license: "MIT" },
    mcp: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "domi-ops": {
          type: "streamable-http", url: url.origin + "/api/mcp",
          extensions: {
            "com.openai": {
              auth: {
                type: "oauth",
                client: clientMode === "cimd" ? { mode: "cimd" } : { mode: "provided", clientId, tokenEndpointAuthMethod: authMethod },
                resource: url.origin + "/api/mcp",
                ...(clientMode === "cimd" ? { baseScopes: ["offline_access"] } : {}),
                defaultScopes: scopes,
              },
            },
          },
        },
      },
    },
  };
}

export async function writePlugin({ output, ...options }) {
  const { plugin, mcp, apps } = pluginConfiguration(options);
  // An existing install/package is never overwritten; credentials are not inputs.
  await mkdir(output, { recursive: false });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const scopes = mcp ? mcp.mcpServers["domi-ops"].extensions["com.openai"].auth.defaultScopes : null;
  // A package bound to an existing registered app cannot know its scopes, so it carries both skills.
  // The actions skill uses only the tools the connection reports as switched on.
  const skills = scopes ? skillNames(scopes) : ["domi-ops-household-briefing", "domi-ops-household-actions"];
  for (const skillName of skills) {
    const skill = join(output, "skills", skillName);
    await mkdir(skill, { recursive: true });
    for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills", skillName, name), join(skill, name));
  }
  await writeFile(join(output, "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  if (mcp) await writeFile(join(output, "mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
  if (apps) await writeFile(join(output, ".app.json"), JSON.stringify(apps, null, 2) + "\n");
  if (options.clientMode === "cimd") {
    const actions = hasActions(scopes);
    await writeFile(join(output, "README.md"), `# Domi Ops household${actions ? "" : " briefing"}

Connect to ${mcp.mcpServers["domi-ops"].url} for:
${scopeSummary(scopes)}. This
package contains one remote HTTPS MCP connection and ${actions ? "two skills: the household briefing and household actions" : "the shared briefing skill"}.
It runs no local commands or background programs. ${actions
  ? `Each ability must be offered by the server's operator, approved when you sign
in and switched on for this connection in Domi Ops under Settings, AI
Connections. ${readsOnSentence(scopes)},
and you can switch any of it off at any time. Actions finish in chat with no
second confirmation in Domi Ops, though ChatGPT may ask you to confirm. Nothing
here can edit, check off, remove, skip, undo or delete a record, or create a
calendar event. ${privacyParagraph(scopes, "ChatGPT")}
There is no School, Drive or attachment access.`
  : `It cannot save changes or
directly access Calendar, School, Health, Drive or attachments.`}

Install using ChatGPT's supported plugin flow, choose OAuth with published
identity (CIMD), sign in to Domi Ops and review your household and permissions.
The operator and household administrator must enable AI connections first.
No client ID, client secret, API key or request header is required. Account and
workspace policies apply. Review provider privacy settings before consenting;
do not share copied Google-derived, health, child or other excluded content.
Disconnect in Domi Ops AI Connections to stop future access; provider copies
remain governed by your ChatGPT settings and terms. Standard integration is
included in hosted pricing and free for self-hosting; a separate ChatGPT account
is required. Self-hosters use their own reachable HTTPS server and package.

Ask for a household briefing using only approved permissions. The skill reports
missing coverage and links to source records. See
[setup](https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_CHATGPT.md),
[privacy](https://domi-ops.com/privacy) and
[support](https://github.com/mwhobrey/domi-ops/issues/new/choose).
This MIT-licensed package does not establish directory approval or live
connectivity. Stop and check the endpoint/settings on a connection error instead
of sharing credentials or disabling authentication.
`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, clientId, output, authMethod] = process.argv.slice(2);
  if (origin === "--cimd") {
    if (!clientId || !output) throw new Error("Usage: node scripts/mcp-chatgpt/package.mjs --cimd CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY [SCOPES_CSV]");
    await writePlugin({ origin: clientId, clientMode: "cimd", output: resolve(output), ...(authMethod === undefined ? {} : { readScopes: authMethod.split(",").map(scope => scope.trim()) }) });
    console.log("Published-identity package created without credentials. Deploy and verify the reviewed onboarding before testing; no live connection or listing claimed.");
  } else if (origin === "--registered") {
    if (!clientId || !output || authMethod) throw new Error("Usage: node scripts/mcp-chatgpt/package.mjs --registered PLUGIN_ASDK_APP_ID NEW_OUTPUT_DIRECTORY");
    await writePlugin({ registeredAppId: clientId, output: resolve(output) });
    console.log("Private skill package created using the existing registered MCP connection. No new endpoint, OAuth client or credentials included.");
  } else {
    if (!origin || !clientId || !output) throw new Error("Usage: node scripts/mcp-chatgpt/package.mjs ORIGIN CLIENT_ID NEW_OUTPUT_DIRECTORY [none|client_secret_basic|client_secret_post]");
    await writePlugin({ origin, clientId, output: resolve(output), authMethod });
    console.log("Private evaluation package created. Connection, exact callback registration and consent are separate; no live compatibility claimed.");
  }
}
