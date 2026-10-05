// Captures the dashboard, health and calendar screens for the share cards.
// Needs the local dev stack on :3000 with the demo household (demo login is public, localhost only).
// Run from the repo root: node scripts/og/shots.mjs && node scripts/og/compose.mjs
// Fails loudly rather than writing a screenshot of a login page or a half-loaded screen.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SCREENS = [
  // [file, path, text that only the loaded screen shows]
  ["dashboard", "/dashboard", "Today at a glance"],
  ["health", "/health", "My checks"],
  ["calendar", "/calendar", "New event"],
];

mkdirSync(".og-cache", { recursive: true });
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('input[type="email"]', process.env.DEMO_OWNER_EMAIL ?? "demo@domi-ops.com");
  await p.fill('input[type="password"]', process.env.DEMO_OWNER_PASSWORD ?? "DemoRivera2026!");
  await p.click('button[type="submit"]');
  await p.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {
    throw new Error("Login did not leave /login; check the dev stack and the demo credentials");
  });

  for (const [name, path, marker] of SCREENS) {
    await p.goto(BASE + path);
    if (new URL(p.url()).pathname.startsWith("/login")) throw new Error(`${path} redirected to /login; not signed in`);
    await p.getByText(marker, { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {
      throw new Error(`${path} never showed "${marker}"; the screen did not load`);
    });
    // The onboarding card hides the real dashboard content.
    const close = p.getByRole("button", { name: /dismiss|close/i }).first();
    if (name === "dashboard" && (await close.count())) await close.click();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(500); // let transitions settle once we know the content is there
    await p.screenshot({ path: `.og-cache/${name}.png` });
    console.log("shot", name);
  }
} finally {
  await b.close();
}
