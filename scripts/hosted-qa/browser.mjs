import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

export async function runBrowserChecks({ origins, token, directory, report }) {
  const fixture = await fetch(`${origins.provider}/__qa/fixtures`, { headers: { "x-qa-token": token } }).then((r) => r.json());
  const alpha = fixture.households.find((h) => h.label === "alpha"), beta = fixture.households.find((h) => h.label === "beta");
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}) });
  const errors = [], contexts = [];
  const context = async (width = 1280) => { const c = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "America/Chicago", locale: "en-US" }); contexts.push(c); c.on("page", (p) => p.on("pageerror", (error) => errors.push({ url: p.url(), message: error.message, stack: error.stack }))); return c; };
  async function step(name, fn) {
    const start = Date.now();
    try { await fn(); report.stages.push({ name, result: "passed", milliseconds: Date.now() - start }); console.log(`PASS ${name}`); }
    catch (error) { report.stages.push({ name, result: "failed", error: error.message }); for (const c of contexts) for (const p of c.pages()) await p.screenshot({ path: join(directory, `failure-${contexts.indexOf(c)}-${c.pages().indexOf(p)}.png`), fullPage: true }).catch(() => {}); throw error; }
  }
  async function login(c, email, username) {
    const page = await c.newPage(); await page.goto(`${origins.web}/login`);
    if (username) { await page.getByRole("tab", { name: "Username", exact: true }).click(); await page.getByLabel("Username", { exact: true }).fill(username); }
    else await page.getByLabel("Email", { exact: true }).fill(email);
    await page.locator('input[name="password"]').fill(fixture.password);
    await page.getByRole("button", { name: username ? "Sign in with username" : "Sign in with email", exact: true }).click();
    await page.waitForURL("**/dashboard", { timeout: 30000 }); return page;
  }
  async function api(c, path, method = "GET", data) {
    return c.request.fetch(`${origins.web}${path}`, { method, ...(data === undefined ? {} : { data }) });
  }
  try {
    const a = await context(), b = await context(), child = await context(390);
    let alphaPage, betaPage, childPage;
    await step("real email/password and username authentication", async () => {
      alphaPage = await login(a, alpha.email); betaPage = await login(b, beta.email); childPage = await login(child, null, fixture.student.username);
      assert.equal((await (await api(a, "/auth/session")).json()).user.role, "owner");
      assert.equal((await (await api(child, "/auth/session")).json()).user.role, "child");
    });
    await step("cross-household and same-household private records", async () => {
      assert.equal((await api(a, `/api/core/drive/objects/${alpha.fileId}/file`)).status(), 200);
      assert.equal((await api(b, `/api/core/drive/objects/${alpha.fileId}/file`)).status(), 404);
      assert.equal((await api(child, `/api/core/drive/objects/${alpha.fileId}/file`)).status(), 404);
      assert.equal((await api(a, `/api/core/drive/objects/${beta.fileId}/file`)).status(), 404);
      const notes = await (await api(a, "/api/core/notes")).text(); assert(!notes.includes(beta.noteId)); assert(notes.includes(alpha.noteId));
    });
    await step("real MinIO upload, byte accounting and safe file download", async () => {
      const before = await (await api(a, "/api/core/household/settings")).json();
      const grant = await (await api(a, "/api/core/drive/presign", "POST", { filename: "qa-active.html", contentType: "text/html" })).json();
      const body = "<html>synthetic active document</html>";
      const put = await a.request.put(grant.uploadUrl, { data: body, headers: { "content-type": "image/png" } }); assert.equal(put.status(), 204);
      const saved = await api(a, "/api/core/drive/objects", "POST", { id: grant.objectId, kind: "file", title: "QA uploaded HTML", s3Key: grant.key, byteSize: 0, contentType: "image/png", visibility: "private" });
      assert.equal(saved.status(), 201, await saved.text());
      const object = (await saved.json()).object;
      assert.equal(object.byteSize, Buffer.byteLength(body)); assert.equal(object.contentType, "text/html");
      const after = await (await api(a, "/api/core/household/settings")).json();
      assert.equal(after.driveStorage.usedBytes - before.driveStorage.usedBytes, Buffer.byteLength(body));
      const file = await api(a, `/api/core/drive/objects/${grant.objectId}/file`);
      assert.equal(file.status(), 200); assert.match(file.headers()["content-disposition"], /^attachment;/); assert.match(file.headers()["content-security-policy"], /sandbox/); assert.equal(await file.text(), body);
      assert.equal((await api(b, `/api/core/drive/objects/${grant.objectId}/file`)).status(), 404);
    });
    await step("course date preview/apply and student permission boundary", async () => {
      const path = `/api/school/classes/${fixture.course.id}/reschedule`, payload = { assignmentIds: [fixture.course.assignmentId], days: 1 };
      assert.equal((await api(child, path, "POST", payload)).status(), 404);
      const preview = await (await api(a, path, "POST", payload)).json(); assert.equal(preview.changes.length, 1);
      const applied = await api(a, path, "POST", { ...payload, apply: true, expected: preview.changes.map(({ id, before, after }) => ({ id, before, after })) }); assert.equal(applied.status(), 200);
      await alphaPage.goto(`${origins.web}/school/class/${fixture.course.id}`);
      await alphaPage.screenshot({ path: join(directory, "course-desktop.png"), fullPage: true });
    });
    let invitedContext, invitedPage, invitedMember;
    await step("email invitation, new account verification and acceptance", async () => {
      const email = `invite-${randomUUID()}@example.test`;
      const response = await api(a, "/api/core/household/invitations", "POST", { email, role: "member", delivery: "email" }); assert.equal(response.status(), 201, await response.text());
      async function message(subject) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const inbox = await fetch(`${origins.mail}/api/v1/messages`).then((r) => r.json());
          const found = inbox.messages.find((m) => m.Subject.includes(subject) && m.To.some((to) => to.Address === email));
          if (found) return fetch(`${origins.mail}/api/v1/message/${found.ID}`).then((r) => r.json());
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`Captured ${subject} email did not arrive`);
      }
      const invitation = await message("invited"), url = invitation.Text.match(/http:\/\/localhost:\d+\/join\?token=[\w-]+/)[0];
      invitedContext = await context(390); invitedPage = await invitedContext.newPage(); await invitedPage.goto(url);
      await invitedPage.waitForURL(`${origins.web}/join`);
      await invitedPage.getByRole("button", { name: "I need an account", exact: true }).click();
      await invitedPage.getByLabel("Your name", { exact: true }).fill("Synthetic invited adult");
      await invitedPage.getByLabel("Password", { exact: true }).fill(fixture.password);
      await invitedPage.getByRole("button", { name: "Create your account", exact: true }).click();
      const verification = await message("Verify");
      const verifyUrl = verification.Text.match(/http:\/\/localhost:\d+\/auth\/verify-email\?[^\s]+/)[0];
      await invitedPage.goto(verifyUrl); await invitedPage.goto(`${origins.web}/join`);
      const joinButton = invitedPage.getByRole("button", { name: "Join household", exact: true });
      if (!await joinButton.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) {
        await invitedPage.getByLabel("Password", { exact: true }).fill(fixture.password);
        await invitedPage.getByRole("button", { name: "Sign in", exact: true }).click();
      }
      await joinButton.click(); await invitedPage.waitForURL("**/dashboard");
      const session = await (await api(invitedContext, "/auth/session")).json(); assert.equal(session.user.role, "member"); invitedMember = session.user.memberId;
      await invitedPage.waitForFunction(() => !document.querySelector(".skeleton-shimmer"));
      await invitedPage.screenshot({ path: join(directory, "invited-adult-mobile.png"), fullPage: true });
    });
    await step("revocation removes existing session household access", async () => {
      const response = await api(a, `/api/core/household/members/${invitedMember}`, "DELETE", { confirm: "REMOVE" }); assert.equal(response.status(), 200);
      assert.equal((await api(invitedContext, "/api/core/notes")).status(), 401);
    });
    await step("marketing checkout, signed webhook provisioning and hosted setup", async () => {
      const c = await context(390), email = `checkout-${randomUUID()}@example.test`;
      let page = await c.newPage();
      await page.goto(`${origins.www}/pricing`);
      await page.getByRole("button", { name: /Start trial.*12\/month/ }).click();
      await page.waitForURL(`${origins.provider}/checkout/**`);
      await page.getByLabel("Email").fill(email); await page.getByRole("button", { name: "Complete simulated checkout" }).click();
      await page.waitForURL(`${origins.web}/setup?session_id=*`);
      await page.getByLabel("Household name", { exact: true }).fill("Synthetic checkout household");
      await page.locator('input[type="password"]').fill(fixture.password);
      await page.getByRole("button", { name: /complete|create|finish/i }).click();
      await page.waitForURL(/\/login|\/dashboard/, { timeout: 30000 });
      if (!page.url().endsWith("/dashboard")) { await page.close(); page = await login(c, email); }
      const session = await (await api(c, "/auth/session")).json(); assert.equal(session.user.role, "owner"); assert.equal(session.subscriptionReadOnly, false);
      await page.goto(`${origins.web}/settings`);
      await page.getByText("Your free trial ends on", { exact: false }).waitFor();
      await page.screenshot({ path: join(directory, "trial-billing-mobile.png"), fullPage: true });
    });
    await step("billing portal cancellation, expiry, read-only access and paid restart", async () => {
      await alphaPage.goto(`${origins.web}/settings`);
      await alphaPage.getByRole("button", { name: /Manage billing/i }).click(); await alphaPage.waitForURL(`${origins.provider}/portal/**`);
      await alphaPage.getByRole("button", { name: "Cancel at period end" }).click(); await alphaPage.waitForURL(`${origins.web}/settings`);
      const settings = await (await api(a, "/api/core/household/settings")).json();
      const paidThrough = new Date(settings.currentPeriodEnd).toLocaleDateString("en-US", { timeZone: settings.timezone, year: "numeric", month: "long", day: "numeric" });
      await alphaPage.getByText(`Renewal is canceled. Your paid access continues through ${paidThrough}.`, { exact: true }).waitFor();
      assert.equal((await (await api(a, "/auth/session")).json()).subscriptionReadOnly, false);
      assert.equal((await api(a, "/api/core/notes", "POST", { title: "QA scheduled cancellation still writable", content: "Synthetic paid-through check", visibility: "private" })).status(), 201);
      const expired = await fetch(`${origins.provider}/__qa/expire`, { method: "POST", headers: { "x-qa-token": token }, body: JSON.stringify({ customerId: alpha.customerId }) }); assert(expired.ok);
      assert.equal((await api(a, "/api/core/notes", "POST", { title: "blocked", content: "blocked" })).status(), 402);
      assert.equal((await api(a, "/api/core/notes")).status(), 200);
      await alphaPage.reload(); await alphaPage.getByRole("button", { name: "Review payment and restart", exact: true }).click(); await alphaPage.waitForURL(`${origins.provider}/checkout/**`);
      await alphaPage.getByRole("button", { name: "Complete simulated checkout" }).click(); await alphaPage.waitForURL(`${origins.web}/setup?session_id=*`);
      assert.equal((await (await api(a, "/auth/session")).json()).subscriptionReadOnly, false);
      assert.equal((await api(a, "/api/core/notes", "POST", { title: "QA paid restart restored writes", content: "Synthetic restart check", visibility: "private" })).status(), 201);
    });
    await step("mobile marketing pages and no browser runtime errors", async () => {
      const c = await context(390), page = await c.newPage();
      for (const path of ["/", "/pricing", "/homeschool", "/health"]) {
        await page.goto(origins.www + path); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.screenshot({ path: join(directory, "marketing-mobile.png"), fullPage: true });
      assert.deepEqual(errors, []);
    });
  } finally { await writeFile(join(directory, "browser-errors.json"), JSON.stringify(errors)); await browser.close(); }
}
