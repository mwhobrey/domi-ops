import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nonPublicMcpHost } from "../hosted-qa/mcp-origin.mjs";

export function pluginConfiguration(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !["", "/"].includes(url.pathname) || nonPublicMcpHost(url.hostname)) throw new Error("Claude cloud connectors require a canonical public HTTPS origin");
  return {
    plugin: { name: "domi-ops-household", version: "0.1.0", description: "Read-only household chores, shopping and explicitly selected planning notes.", author: { name: "Domi Ops" }, license: "MIT" },
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
  for (const name of ["SKILL.md", "LICENSE.txt"]) await copyFile(join(root, "skills", "domi-ops-household-briefing", name), join(skill, name));
  await writeFile(join(output, ".claude-plugin", "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  await writeFile(join(output, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, output, ...extra] = process.argv.slice(2);
  if (!origin || !output || extra.length) throw new Error("Usage: node scripts/mcp-claude/package.mjs CANONICAL_HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY");
  await writePlugin({ origin, output: resolve(output) });
  console.log("Private Claude evaluation package created. Configure the pre-registered OAuth client in Claude separately; no credentials included or live compatibility claimed.");
}
