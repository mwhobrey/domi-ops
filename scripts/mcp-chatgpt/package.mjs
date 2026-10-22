import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function pluginConfiguration({ origin, clientId, authMethod = "none", registeredAppId }) {
  if (registeredAppId !== undefined) {
    if (origin !== undefined || clientId !== undefined || typeof registeredAppId !== "string" || !/^(?:plugin_)?asdk_app_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(registeredAppId)) throw new Error("One registered ChatGPT MCP plugin ID required; endpoint/client options cannot be combined");
    // ChatGPT URLs use plugin_asdk_app_..., but .app.json requires the server's asdk_app_... ID.
    const appId = registeredAppId.replace(/^plugin_/, "");
    return {
      plugin: { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "domi-ops-household", version: "0.1.0", description: "Read-only household chores, shopping and explicitly selected planning notes.", license: "MIT", extensions: { "com.openai": { apps: "./.app.json" } } },
      apps: { apps: { "domi-ops": { id: appId, required: true } } },
    };
  }
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("Canonical HTTPS or local loopback origin required");
  if (typeof clientId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/.test(clientId)) throw new Error("Registered public client ID required");
  if (!["none", "client_secret_basic", "client_secret_post"].includes(authMethod)) throw new Error("Unsupported token authentication method");
  return {
    plugin: { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "domi-ops-household", version: "0.1.0", description: "Read-only household chores, shopping and explicitly selected planning notes.", license: "MIT" },
    mcp: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "domi-ops": {
          type: "streamable-http", url: url.origin + "/api/mcp",
          extensions: {
            "com.openai": {
              auth: {
                type: "oauth",
                client: { mode: "provided", clientId, tokenEndpointAuthMethod: authMethod },
                resource: url.origin + "/api/mcp",
                defaultScopes: ["shopping:read", "chores:read", "notes:read", "offline_access"],
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
  const skill = join(output, "skills", "domi-ops-household-briefing");
  await mkdir(skill, { recursive: true });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills", "domi-ops-household-briefing", name), join(skill, name));
  await writeFile(join(output, "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  if (mcp) await writeFile(join(output, "mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
  if (apps) await writeFile(join(output, ".app.json"), JSON.stringify(apps, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, clientId, output, authMethod] = process.argv.slice(2);
  if (origin === "--registered") {
    if (!clientId || !output || authMethod) throw new Error("Usage: node scripts/mcp-chatgpt/package.mjs --registered PLUGIN_ASDK_APP_ID NEW_OUTPUT_DIRECTORY");
    await writePlugin({ registeredAppId: clientId, output: resolve(output) });
    console.log("Private skill package created using the existing registered MCP connection. No new endpoint, OAuth client or credentials included.");
  } else {
    if (!origin || !clientId || !output) throw new Error("Usage: node scripts/mcp-chatgpt/package.mjs ORIGIN CLIENT_ID NEW_OUTPUT_DIRECTORY [none|client_secret_basic|client_secret_post]");
    await writePlugin({ origin, clientId, output: resolve(output), authMethod });
    console.log("Private evaluation package created. Connection, exact callback registration and consent are separate; no live compatibility claimed.");
  }
}
