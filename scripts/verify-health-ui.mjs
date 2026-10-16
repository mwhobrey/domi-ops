// Local UI regression checks with a fixture API. Does not connect to a household database.
// Run: node scripts/verify-health-ui.mjs (uses Edge; set PLAYWRIGHT_CHANNEL for another channel).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(path.join(tmpdir(), "domi-health-qa-"));
const apiPort = 14401;
const webPort = 13105;
const origin = `http://localhost:${webPort}`;
let reportDelay = 150;
let rosterDelay = 0;
let failReport = false;
let staleFailure = false;
let medicationsOnly = false;
let smokeFailurePath = null;
const smokeRoutes = [
  { route: "/goals", apiPath: "/api/goals", ready: "No goals yet" },
  { route: "/shopping", apiPath: "/api/core/shopping", ready: "List is empty" },
  { route: "/chores", apiPath: "/api/core/chores", ready: "No open chores" },
  { route: "/expenses", apiPath: "/api/core/expenses", ready: "No expenses" },
  { route: "/school/records", apiPath: "/api/school/records/students", ready: "No students yet" },
];
const requests = [];
const labels = { overview: "Events", trends: "Trends", "medications-today": "Today's doses", medications: "Dose history", "medication-list": "Medication list", exercise: "Exercise", pain: "Pain", nutrition: "Nutrition", "check-adherence": "Check adherence", "blood-pressure": "Blood pressure" };
const members = [{ memberId: "a", label: "Alex" }, { memberId: "b", label: "Bailey" }];
const session = { authenticated: true, modulesEnabled: ["core", "health", "school", "calendar_sync", "goals"], householdTimezone: "America/Chicago", user: { memberId: "a", name: "Alex", email: "fixture@example.invalid", username: "alex", role: "owner", avatarUrl: null }, telemetryOptIn: false };
const shift = (date, amount) => new Date(Date.parse(`${date}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);

function reportFor(url) {
  const to = url.searchParams.get("to");
  const from = url.searchParams.get("from");
  const member = url.searchParams.get("memberId") || "a";
  const name = member === "b" ? "Bailey" : "Alex";
  const dates = [-4, -2, 0].map((n) => shift(to, n));
  const medName = `${name} medication`;
  return {
    from, to, timezone: "America/Chicago", memberId: member,
    summary: { totalEvents: 0, ongoingCount: 0, activeMedications: 1, scheduledMedications: 1, prnMedications: 0, dosesLogged: 2 },
    eventsByType: [], eventsByMember: [], eventHistory: [], eventGroups: [], todayDoses: [], medications: [{ id: "m1", name: medName, memberId: member, memberLabel: name, scheduleKind: "scheduled", enabled: true }],
    medicationAdherence: [{ medicationId: "m1", name: medName, memberId: member, memberLabel: name, scheduleKind: "scheduled", taken: 2, skipped: 0, missed: 1, pending: 0, prn: 0, scheduledTotal: 3, adherencePct: 67 }],
    medicationDoseTrend: [{ medicationId: "m1", name: medName, memberId: member, scheduleKind: "scheduled", points: dates.map((date, i) => ({ date, taken: i === 1 ? 0 : 1, skipped: 0, missed: i === 1 ? 1 : 0, pending: 0, prn: 0 })) }],
    medicationMarkers: [{ medicationId: "m1", name: medName, memberId: member, memberLabel: name, date: dates[1], kind: "start" }],
    medicationLogHistory: [{ id: "l1", medicationId: "m1", memberId: member, medicationName: medName, memberLabel: name, status: "taken", loggedAt: `${to}T13:00:00Z`, loggedAtLabel: "8 AM", scheduledAt: `${to}T13:00:00Z`, scheduledAtLabel: "8 AM", prn: false }],
    vitalsTrend: medicationsOnly ? [] : ["blood_pressure_systolic", "blood_pressure_diastolic"].map((metric, index) => ({ metric, metricLabel: index ? "BP diastolic" : "BP systolic", memberId: member, points: dates.map((date, i) => ({ eventId: `v${i}`, date, at: `${date}T14:00:00Z`, whenLabel: `${date}, 9 AM`, value: (index ? [80, 100, 82] : [120, 170, 125])[i], unit: "mmHg" })) })),
    exerciseTrend: { points: [] }, exerciseByActivity: [], painByRegion: [], painTrend: [], nutritionTrend: { points: [] }, prnFrequency: [],
    activityTrend: medicationsOnly ? [] : [{ memberId: member, memberLabel: name, points: dates.map((date, i) => ({ date, steps: 4000 + 1000 * i, distanceKm: 3, activeMinutes: 30, caloriesActive: 200 })) }],
    sleepTrend: medicationsOnly ? [] : [{ memberId: member, memberLabel: name, points: dates.map((date, i) => ({ date, totalMinutes: 400 + i * 20, inBedMinutes: 480, lightMinutes: 240, deepMinutes: 60, remMinutes: 100, awakeMinutes: 20, score: 80 })) }],
  };
}

const api = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  requests.push(url.pathname + url.search);
  let delay = 0;
  let status = 200;
  let data = { notifications: [], notices: [], unreadCount: 0, items: [], recurring: [], expenses: [], budgets: [], suggestions: [], chores: [], members: [], goals: [], rewards: [], students: [] };
  if (url.pathname === "/auth/session") data = session;
  if (url.pathname === "/api/core/household/roster") { data = { members }; delay = rosterDelay; }
  if (url.pathname === "/api/core/reports/catalog") data = { catalog: [{ module: "health", moduleLabel: "Health", kinds: Object.entries(labels).map(([id, label]) => ({ id, label })) }] };
  if (url.pathname === "/api/health/reports") {
    data = reportFor(url); delay = reportDelay;
    if (staleFailure && url.searchParams.get("memberId") === "a") { status = 500; delay = 900; }
    if (failReport) { status = 500; data = { error: "fixture_failure" }; }
  }
  if (url.pathname === "/api/core/reports") data = { report: { title: labels[url.searchParams.get("kind")], sections: [] } };
  if (url.pathname === "/api/health/events") data = { events: [] };
  if (url.pathname === "/api/health/glance") data = { pendingDoses: [], pendingGroupDoses: [], prnMedications: [], loggedToday: [] };
  if (url.pathname === "/api/health/capabilities") data = { bySubject: Object.fromEntries(members.map((m) => [m.memberId, { events: { read: true, write: true }, medications: { read: true, write: true } }])) };
  if (url.pathname === "/api/health/dose-logs") data = { logs: [] };
  if (url.pathname === "/api/health/checks" || url.pathname === "/api/health/checks/slots") data = { checks: [] };
  if (url.pathname === "/api/health/check-groups") data = { groups: [] };
  if (url.pathname === "/api/health/medications") data = { medications: [] };
  if (url.pathname === "/api/health/withings") data = { enabled: false, links: [] };
  if (smokeRoutes.some((route) => route.apiPath === url.pathname)) {
    delay = 600;
    if (smokeFailurePath === url.pathname) { status = 500; data = { error: "fixture_smoke_failure" }; }
  }
  setTimeout(() => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }, delay);
});

await new Promise((resolve, reject) => { api.once("error", reject); api.listen(apiPort, "127.0.0.1", resolve); });
const log = path.join(out, "next.log");
const next = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", path.join(root, "apps/web"), "--port", String(webPort)], { cwd: root, env: { ...process.env, API_URL: `http://127.0.0.1:${apiPort}`, PUBLIC_APP_URL: origin, NEXT_PUBLIC_APP_URL: origin, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", openSync(log, "w"), openSync(log, "a")] });
let browser;
const errors = [];
try {
  for (let i = 0; i < 90; i++) {
    try { const response = await fetch(`${origin}/reports?module=health&kind=overview`); if (response.ok) break; } catch {}
    if (next.exitCode != null) throw new Error(readFileSync(log, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/reports?module=health&kind=medication-list`);
  const picker = page.getByRole("combobox", { name: "Report type", exact: true }).filter({ visible: true });
  await picker.waitFor();
  for (const [kind, expected] of [["exercise", "Exercise summary"], ["pain", "Pain summary"], ["nutrition", "Nutrition summary"], ["check-adherence", "Check adherence"], ["blood-pressure", "Blood pressure"]]) {
    await picker.selectOption(kind);
    await page.getByRole("heading", { name: expected, exact: true }).waitFor();
    assert.equal(await picker.inputValue(), kind);
    assert.equal(new URL(page.url()).searchParams.get("kind"), kind);
  }
  console.log("PASS: every report type after Medication list keeps its selection and renders its pane");
  reportDelay = 1200;
  await picker.selectOption("trends");
  await page.getByRole("status", { name: "Loading trends", exact: true }).waitFor();
  assert.equal(await page.locator("main").filter({ visible: true }).getByRole("alert").count(), 0);
  await page.getByRole("heading", { name: "Vitals and medications", exact: true }).waitFor();
  await page.locator(".recharts-line-curve").first().waitFor();
  assert.equal(await page.getByRole("heading", { name: "No trends yet" }).count(), 0);
  const missed = page.getByRole("button", { name: /Alex medication,.*0 taken, 0 skipped, 1 missed/ });
  await missed.click();
  await page.getByText(/Systolic: 170 mmHg/).waitFor();
  await page.getByText("Alex medication: 0 taken, 0 skipped, 1 missed, 0 pending, 0 as-needed", { exact: true }).waitFor();
  await page.getByText("Started Alex medication", { exact: true }).waitFor();
  const dots = page.locator(".recharts-line-dots").first().locator(".recharts-line-dot");
  await dots.nth(2).hover();
  await dots.nth(2).click();
  await page.getByText(/Systolic: 125 mmHg/).waitFor();
  await missed.click();
  const timelineWindow = page.getByRole("combobox", { name: "Timeline window", exact: true });
  await timelineWindow.selectOption("14");
  await timelineWindow.selectOption("30");
  await timelineWindow.selectOption("7");
  await page.getByRole("button", { name: "Earlier", exact: true }).click();
  await page.getByText("No readings recorded in this window.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await missed.waitFor();
  await page.getByLabel("Alex medication", { exact: true }).uncheck();
  assert.equal(await missed.count(), 0);
  await page.getByLabel("Alex medication", { exact: true }).check();
  assert.equal(await page.locator("details[open]").count(), 0);
  await page.screenshot({ path: path.join(out, "trends-desktop.png"), fullPage: true });
  console.log("PASS: delayed trends show skeletons; same-day outlier, missed dose, and medication change inspect together; medication toggles work; data tables start folded");
  staleFailure = true;
  const member = page.getByRole("combobox", { name: "Member", exact: true }).filter({ visible: true });
  await member.selectOption("b");
  assert.equal(await page.getByRole("heading", { name: "Alex medication", exact: true }).count(), 0);
  await page.getByRole("heading", { name: "Bailey medication", exact: true }).waitFor();
  // Start a slower failing request, then a newer successful one.
  const isStaleReport = (url) => url.pathname === "/api/health/reports" && url.searchParams.get("memberId") === "a";
  const staleRequest = page.waitForRequest((request) => isStaleReport(new URL(request.url())));
  const staleResponse = page.waitForResponse((response) => isStaleReport(new URL(response.url())) && response.status() === 500);
  await member.selectOption("a");
  await staleRequest;
  reportDelay = 80;
  await member.selectOption("b");
  await page.getByRole("heading", { name: "Bailey medication", exact: true }).waitFor();
  assert.equal(await (await staleResponse).finished(), null);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator("main").filter({ visible: true }).getByRole("alert").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Bailey medication", exact: true }).count(), 1);
  staleFailure = false;
  console.log("PASS: member switching hides previous charts and ignores an older failing response");
  failReport = true;
  await member.selectOption("a");
  await page.locator("main").filter({ visible: true }).getByRole("alert").waitFor();
  failReport = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("heading", { name: "Alex medication", exact: true }).waitFor();
  console.log("PASS: actual report failure stays visible and Retry recovers");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".recharts-line-curve").first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(out, "trends-mobile.png"), fullPage: true });
  console.log("PASS: mobile trends contain wide timelines without overflowing the page");
  medicationsOnly = true;
  await page.reload();
  await page.getByRole("heading", { name: "Alex medication", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "No trends yet" }).count(), 0);
  medicationsOnly = false;
  rosterDelay = 2000;
  const start = requests.length;
  await page.goto(`${origin}/health`, { waitUntil: "commit" });
  await page.getByRole("status", { name: "Loading health", exact: true }).waitFor();
  assert.equal(requests.slice(start).some((r) => r.startsWith("/api/health/events")), false);
  assert.equal(await page.locator("main").filter({ visible: true }).getByRole("alert").count(), 0);
  await page.getByRole("button", { name: "Trends", exact: true }).waitFor();
  await page.getByRole("button", { name: "Trends", exact: true }).click();
  await page.getByRole("heading", { name: "Vitals and medications", exact: true }).waitFor();
  rosterDelay = 0;
  console.log("PASS: Health route fallback issues no health-data requests and the Health tab opens the same explorer");
  await page.goto(`${origin}/health/reports`);
  await page.getByRole("button", { name: "Trends", exact: true }).click();
  await page.getByRole("heading", { name: "Vitals and medications", exact: true }).waitFor();
  for (const { route, ready } of smokeRoutes) {
    await page.goto(`${origin}${route}`);
    await page.locator("main").filter({ visible: true }).getByText(ready, { exact: true }).waitFor();
    assert.equal(await page.locator("main").filter({ visible: true }).getByRole("alert").count(), 0, `Unexpected error at ${route}`);
  }
  smokeFailurePath = "/api/goals";
  await page.goto(`${origin}/goals`, { waitUntil: "commit" });
  await page.locator("main").filter({ visible: true }).getByRole("alert").filter({ hasText: "API 500" }).waitFor();
  assert.equal(await page.getByText("No goals yet", { exact: true }).count(), 0);
  smokeFailurePath = null;
  await page.getByRole("link", { name: "Retry", exact: true }).click();
  await page.locator("main").filter({ visible: true }).getByText("No goals yet", { exact: true }).waitFor();
  assert.equal(await page.locator("main").filter({ visible: true }).getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: route smoke checks and no uncaught browser errors. Screenshots: ${out}`);
} catch (error) {
  console.error(`UI verification failed. Evidence: ${out}`);
  for (const page of browser?.contexts().flatMap((context) => context.pages()) ?? []) {
    console.error("Alerts:", await page.locator("main").filter({ visible: true }).getByRole("alert").allTextContents());
    console.error("Browser errors:", errors);
    await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  next.kill();
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
}
