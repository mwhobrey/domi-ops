import { mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Gemini imports a root SKILL.md. Connection setup remains separate: this
// archive grants no access and contains no account-bound endpoint or credential.
export async function writeSkill({ output }) {
  await mkdir(output, { recursive: false });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const name of ["SKILL.md", "LICENSE.txt"]) {
    await copyFile(join(root, "skills", "domi-ops-household-briefing", name), join(output, name));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error("Usage: node scripts/mcp-gemini/package.mjs NEW_OUTPUT_DIRECTORY");
  await writeSkill({ output: resolve(output) });
  console.log("Gemini skill folder created. ZIP its contents with SKILL.md at the archive root. Configure an approved synthetic MCP connection separately; no live compatibility claimed.");
}
