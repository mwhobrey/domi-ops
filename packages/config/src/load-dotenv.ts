import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LOADED_FLAG = "WHOME_DOTENV_LOADED";

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/** Walk up from cwd and hydrate process.env from the first `.env` found (no overrides). */
export function loadRootDotenv(): void {
  if (process.env[LOADED_FLAG]) return;

  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const envPath = resolve(dir, ".env");
    if (existsSync(envPath)) {
      const text = readFileSync(envPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const parsed = parseLine(line);
        if (!parsed) continue;
        if (process.env[parsed.key] === undefined) {
          process.env[parsed.key] = parsed.value;
        }
      }
      process.env[LOADED_FLAG] = "1";
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function resetRootDotenvFlag(): void {
  delete process.env[LOADED_FLAG];
}
