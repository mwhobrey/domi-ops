// Captures the dashboard, health and calendar screens for the share cards.
// Needs the local dev stack on :3000 with the demo household (demo login is public, localhost only).
// Run from the repo root: node scripts/og/shots.mjs && node scripts/og/compose.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync(".og-cache", { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/login");
await p.fill('input[type="email"]', process.env.DEMO_OWNER_EMAIL ?? "demo@domi-ops.com");
await p.fill('input[type="password"]', process.env.DEMO_OWNER_PASSWORD ?? "DemoRivera2026!");
await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
for (const [name, path] of [["dashboard", "/dashboard"], ["health", "/health"], ["calendar", "/calendar"]]) {
  await p.goto("http://localhost:3000" + path);
  await p.waitForTimeout(4000);
  const close = p.getByRole("button", { name: /dismiss|close/i }).first();
  if (name === "dashboard" && (await close.count())) await close.click();
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `.og-cache/${name}.png` });
  console.log("shot", name);
}
await b.close();
