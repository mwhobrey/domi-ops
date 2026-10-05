import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { writeFileSync } from "node:fs";
const U = (p) => pathToFileURL(path.resolve(p)).href;
const logo = U("apps/web/public/icons/icon-main.png");
const variants = {
  default: {
    out: "apps/www/public/og/og-default.png",
    headline: "The household hub for <span>homeschool families</span>",
    sub: "School, calendar, chores and health in one place.",
    chips: ["Gradebook", "Calendar", "Chores", "Health"],
    a: U(".og-cache/dashboard.png"),
    b: U(".og-cache/calendar.png"),
  },
  health: {
    out: "apps/www/public/og/og-health.png",
    headline: "Health tracking your <span>whole family</span> can actually keep up with",
    sub: "Medications, scheduled checks, reminders and reports. Encrypted at rest.",
    chips: ["Medications", "Scheduled checks", "Reminders", "Reports"],
    a: U(".og-cache/health.png"),
    b: U(".og-cache/dashboard.png"),
  },
};
const html = (v) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:Inter,system-ui,sans-serif;color:#f1f5f9;
 background:radial-gradient(900px 520px at 8% 0%,rgba(20,184,166,.28),transparent 60%),radial-gradient(800px 600px at 100% 100%,rgba(59,130,246,.30),transparent 60%),linear-gradient(135deg,#0a0e14,#0f1623 60%,#0b1220)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.06) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(90deg,#000,transparent 75%)}
.left{position:absolute;left:64px;top:56px;width:520px}
.brand{display:flex;align-items:center;gap:16px}
.brand img{width:76px;height:76px}
.brand b{font:700 40px 'Space Grotesk',sans-serif;letter-spacing:-.5px}
h1{margin-top:44px;font:700 52px/1.08 'Space Grotesk',sans-serif;letter-spacing:-1.2px}
h1 span{background:linear-gradient(90deg,#2dd4bf,#38bdf8 60%,#60a5fa);-webkit-background-clip:text;color:transparent}
p{margin-top:22px;font:400 22px/1.4 Inter;color:#94a3b8;max-width:520px}
.chips{position:absolute;left:64px;bottom:52px;display:flex;gap:10px}
.chips i{font:600 16px Inter;font-style:normal;padding:9px 16px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:rgba(15,23,42,.65);color:#cbd5e1}
.shot{position:absolute;border-radius:16px;overflow:hidden;border:1px solid rgba(148,163,184,.3);box-shadow:0 30px 70px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04)}
.shot img{display:block;width:100%}
.s1{left:640px;top:70px;width:640px;height:400px;transform:rotate(-3deg)}
.s2{left:700px;top:300px;width:600px;height:340px;transform:rotate(2.5deg)}
.s1 img,.s2 img{width:1280px;transform-origin:0 0}
.s1 img{transform:scale(.5)}
.s2 img{transform:scale(.47)}
</style></head><body><div class="grid"></div>
<div class="left"><div class="brand"><img src="${logo}"><b>Domi Ops</b></div>
<h1>${v.headline}</h1><p>${v.sub}</p></div>
<div class="chips">${v.chips.map((c) => `<i>${c}</i>`).join("")}</div>
<div class="shot s1"><img src="${v.b}"></div>
<div class="shot s2"><img src="${v.a}"></div>
</body></html>`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [name, v] of Object.entries(variants)) {
  const p = await ctx.newPage();
  writeFileSync(`.og-cache/${name}.html`, html(v));
  await p.goto(U(`.og-cache/${name}.html`), { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: v.out });
  console.log("wrote", v.out, name);
}
await b.close();
