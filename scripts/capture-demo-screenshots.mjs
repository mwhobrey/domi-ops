#!/usr/bin/env node
/**
 * Capture marketing screenshots from the Rivera demo household (WHO-190 Phase 2).
 *
 * Prerequisites:
 *   - Postgres seeded: npm run db:seed-demo
 *   - App running: npm run dev (web :3000 + api :4000)
 *   - Playwright browsers: npx playwright install chromium
 *
 * Usage:
 *   npm run marketing:capture-screenshots
 *   npm run marketing:capture-screenshots -- --theme light
 *   npm run marketing:capture-screenshots -- --only calendar-week --theme both
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIRS = [
  path.join(REPO_ROOT, "docs/marketing/screenshots"),
  path.join(REPO_ROOT, "apps/web/public/marketing/screenshots"),
];

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

const DEFAULT_EMAIL = "demo@domi-ops.com";
const DEFAULT_PASSWORD = "DemoRivera2026!";

function loadRootEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const only = [];
  let theme = "both";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only" && argv[i + 1]) {
      only.push(...argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    } else if (argv[i] === "--theme" && argv[i + 1]) {
      theme = argv[++i];
    }
  }
  if (!["light", "dark", "both"].includes(theme)) {
    console.error(`Invalid --theme ${theme} (use light, dark, or both)`);
    process.exit(1);
  }
  return { only, theme };
}

function screenshotFileName(shot, variant, theme) {
  const size = variant.viewport;
  return `${shot.priority}-${shot.id}-${variant.suffix}-${size.width}x${size.height}-${theme}.png`;
}

function pruneLegacyScreenshots() {
  for (const dir of OUT_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".png")) continue;
      if (/-(?:light|dark)\.png$/.test(file)) continue;
      unlinkSync(path.join(dir, file));
    }
  }
}

/** @type {import('playwright').Page} */
async function hideDevChrome(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dialog],
      #__next-build-watcher {
        display: none !important;
        visibility: hidden !important;
      }
    `,
  });
}

async function signIn(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function applyDemoPrefs(page, { calendarView } = {}) {
  const session = await page.evaluate(async () => {
    const res = await fetch("/auth/session", { credentials: "include" });
    return res.json();
  });

  await page.evaluate(
    ({ memberId, view }) => {
      if (view) localStorage.setItem("whome:calendar-view", view);
      localStorage.setItem("whome:calendar-setup-dismissed", "1");
      if (memberId) {
        localStorage.setItem(`whome:profile-onboarding-dismissed:${memberId}`, "1");
      }
    },
    { memberId: session?.user?.memberId ?? null, view: calendarView ?? "week" },
  );

  return session;
}

async function fetchMathClassId(page) {
  const data = await page.evaluate(async () => {
    const res = await fetch("/api/school/classes", { credentials: "include" });
    if (!res.ok) throw new Error(`school/classes ${res.status}`);
    return res.json();
  });
  const math = data.classes?.find((c) => c.name === "Math 6");
  if (!math?.id) {
    throw new Error('Could not find "Math 6" class — run npm run db:seed-demo first');
  }
  return math.id;
}

async function waitForRoute(page, route, { calendarView } = {}) {
  if (route.startsWith("/calendar")) {
    const tabName = calendarView === "week" ? "Week" : "Agenda";
    const tab = page.getByRole("tab", { name: tabName });
    await tab.waitFor({ state: "visible", timeout: 30_000 });
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      await tab.click();
    }
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    return;
  }

  if (route.startsWith("/school")) {
    await page
      .getByRole("heading", { name: /school|math|gradebook/i })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => page.waitForLoadState("networkidle"));
    return;
  }

  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function captureViewport(page, fileName) {
  const primaryDir = OUT_DIRS[0];
  mkdirSync(primaryDir, { recursive: true });
  const primaryPath = path.join(primaryDir, fileName);
  await hideDevChrome(page);
  await page.screenshot({ path: primaryPath, type: "png", animations: "disabled" });
  console.log(`  wrote ${path.relative(REPO_ROOT, primaryPath)}`);

  for (const dir of OUT_DIRS.slice(1)) {
    mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, fileName);
    if (dest !== primaryPath) copyFileSync(primaryPath, dest);
  }
}

const SHOTS = [
  {
    id: "calendar-week",
    priority: "p0",
    routes: [
      { suffix: "desktop", viewport: DESKTOP, calendarView: "week" },
      { suffix: "mobile", viewport: MOBILE, calendarView: "agenda" },
    ],
    path: "/calendar",
  },
  {
    id: "dashboard",
    priority: "p1",
    routes: [
      { suffix: "desktop", viewport: DESKTOP },
      { suffix: "mobile", viewport: MOBILE },
    ],
    path: "/dashboard",
  },
  {
    id: "school",
    priority: "p1",
    routes: [
      { suffix: "desktop", viewport: DESKTOP },
      { suffix: "mobile", viewport: MOBILE },
    ],
    path: "/school",
  },
  {
    id: "school-gradebook",
    priority: "p1",
    routes: [{ suffix: "desktop", viewport: DESKTOP }],
    path: (ctx) => `/school/class/${ctx.mathClassId}/gradebook`,
  },
  {
    id: "chores",
    priority: "p2",
    routes: [{ suffix: "desktop", viewport: DESKTOP }],
    path: "/chores",
  },
  {
    id: "drive",
    priority: "p2",
    routes: [{ suffix: "desktop", viewport: DESKTOP }],
    path: "/drive",
  },
];

async function captureTheme(browser, theme, shots, baseUrl, email, password) {
  const context = await browser.newContext({
    viewport: DESKTOP,
    colorScheme: theme,
    locale: "en-US",
    timezoneId: "America/Chicago",
  });
  const page = await context.newPage();

  try {
    await signIn(page, baseUrl, email, password);
    const session = await applyDemoPrefs(page, { calendarView: "week" });
    if (!session?.authenticated) {
      throw new Error("Login failed — /auth/session not authenticated");
    }

    const ctx = { mathClassId: await fetchMathClassId(page) };

    for (const shot of shots) {
      const routePath = typeof shot.path === "function" ? shot.path(ctx) : shot.path;
      console.log(`\n[${theme}] ${shot.priority.toUpperCase()} ${shot.id} (${routePath})`);

      for (const variant of shot.routes) {
        const size = variant.viewport;
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.emulateMedia({ media: "screen", colorScheme: theme });

        await page.goto(`${baseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
        await applyDemoPrefs(page, { calendarView: variant.calendarView });
        await waitForRoute(page, routePath, { calendarView: variant.calendarView });

        await captureViewport(page, screenshotFileName(shot, variant, theme));
      }
    }
  } finally {
    await context.close();
  }
}

async function main() {
  loadRootEnv();
  const { only, theme } = parseArgs(process.argv.slice(2));

  const baseUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const email = (process.env.DEMO_OWNER_EMAIL ?? DEFAULT_EMAIL).toLowerCase();
  const password = process.env.DEMO_OWNER_PASSWORD ?? DEFAULT_PASSWORD;

  let shots = SHOTS;
  if (only.length > 0) {
    shots = SHOTS.filter((s) => only.includes(s.id));
    if (shots.length === 0) {
      console.error(`No matching shots for --only ${only.join(",")}`);
      console.error(`Available: ${SHOTS.map((s) => s.id).join(", ")}`);
      process.exit(1);
    }
  }

  const themes = theme === "both" ? ["light", "dark"] : [theme];

  console.log("Capturing demo screenshots (light + dark) → docs + apps/web/public");
  console.log(`  App:    ${baseUrl}`);
  console.log(`  User:   ${email}`);
  console.log(`  Themes: ${themes.join(", ")}`);

  pruneLegacyScreenshots();

  const browser = await chromium.launch({ headless: true });
  try {
    for (const t of themes) {
      await captureTheme(browser, t, shots, baseUrl, email, password);
    }
    console.log("\nDone.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
