import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = ["www/index.html", "www/app.js", "www/styles.css", "capacitor.config.ts"];

for (const rel of required) {
  const full = path.join(root, rel);
  if (!existsSync(full)) {
    console.error(`[mobile] missing ${rel}`);
    process.exit(1);
  }
}

console.log("[mobile] www/ shell OK");
