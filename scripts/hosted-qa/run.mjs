import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserChecks } from "./browser.mjs";
import { assertOwnership, assertVolumes } from "./ownership.mjs";
import { configureMcpOrigin } from "./mcp-origin.mjs";
import { openSync, writeFileSync, closeSync, unlinkSync, readFileSync } from "node:fs";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const directory = join(root, ".qa", "hosted");
const project = `domi-ops-qa-${createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 10)}`;
const marker = "domi-ops-hosted-qa-v1";
const statePath = join(directory, "state.json"), envPath = join(directory, "compose.env");
const command = process.argv[2] ?? "run";
const supported = ["run", "up", "mcp", "test", "status", "logs", "down", "reset", "providers"];
if (!supported.includes(command)) throw new Error(`Use ${supported.join(" | ")}`);
await mkdir(directory, { recursive: true });
if (!["status", "logs"].includes(command)) {
  const lock = join(directory, "command.lock");
  try {
    const prior = JSON.parse(readFileSync(lock, "utf8"));
    let running = true;
    try { process.kill(prior.pid, 0); } catch (error) { if (error.code === "ESRCH") running = false; }
    if (running) throw new Error(`QA command ${prior.command} is already running (PID ${prior.pid})`);
    unlinkSync(lock);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const fd = openSync(lock, "wx", 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, command })); closeSync(fd);
  process.once("exit", () => { try { unlinkSync(lock); } catch {} });
}
let state = await readFile(statePath, "utf8").then(JSON.parse).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
const fresh = !state;
if (!state) {
  if (["down", "reset", "test", "status", "logs"].includes(command)) throw new Error("No owned QA stack found. Run npm run qa:hosted:up first.");
  const base = Number(process.env.DOMI_QA_BASE_PORT ?? 13180);
  if (!Number.isInteger(base) || base < 1024 || base > 60000) throw new Error("DOMI_QA_BASE_PORT must be 1024–60000");
  state = { marker, root, project, mode: "fixture", image: `${project}:local`, ports: Object.fromEntries(["web", "www", "mail", "provider", "db", "archive", "s3"].map((name, i) => [name, base + i])), secrets: Object.fromEntries(["ADMIN_PASSWORD", "APP_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY", "S3_PASSWORD", "TOKEN"].map((name) => [name, randomBytes(32).toString("hex")])) };
  await checkPorts(state.ports);
}
assertOwnership(state, root, project);
const localOrigin = `http://localhost:${state.ports.web}`;
const canonicalMcp = configureMcpOrigin({ origin: state.mcpOrigin, port: state.ports.web, command, requested: process.env.DOMI_QA_MCP_ORIGIN, fresh });
if (command === "mcp") state.mcpOrigin = canonicalMcp.origin;
const publicMcp = canonicalMcp.remote;
if (process.env.DOMI_QA_MCP_GROK_BOT !== undefined) {
  if (command !== "mcp" || !["true", "false"].includes(process.env.DOMI_QA_MCP_GROK_BOT)) throw new Error("Grok Bot QA option is limited to explicit synthetic MCP mode");
  const requested = process.env.DOMI_QA_MCP_GROK_BOT === "true";
  if (!fresh && requested !== Boolean(state.grokBot)) throw new Error("Use a fresh synthetic lab for a different provider/discovery scope profile");
  state.grokBot = requested;
}
if (state.grokBot && command === "mcp" && !publicMcp) throw new Error("Grok Bot QA requires its own public HTTPS synthetic origin");

const baseEnv = { ...process.env };
for (const name of Object.keys(baseEnv)) if (name.startsWith("DOMI_QA_")) delete baseEnv[name];
const execute = (exe, args, capture = false) => new Promise((resolvePromise, reject) => {
  const child = spawn(exe, args, { cwd: root, env: baseEnv, windowsHide: true, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  let out = "", err = "";
  child.stdout?.on("data", (data) => { out += data; }); child.stderr?.on("data", (data) => { err += data; });
  child.on("error", reject); child.on("exit", (code) => code === 0 ? resolvePromise(out.trim()) : reject(new Error(`${exe} ${args.slice(0, 3).join(" ")} failed (${code})${capture ? `: ${err}` : ""}`)));
});
const compose = (args, capture = false) => execute("docker", ["compose", "--project-name", project, "--file", join(root, "docker-compose.qa.yml"), "--env-file", envPath, ...args], capture);
let providers = {};
if (command === "providers") {
  const input = await readFile(join(directory, "providers.env"), "utf8").catch(() => { throw new Error("Copy scripts/hosted-qa/providers.env.example to .qa/hosted/providers.env and fill testing credentials first."); });
  const allowed = new Set(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_PICKER_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER_MONTHLY", "STRIPE_PRICE_STARTER_ANNUAL"]);
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Z_]+)=(.*)$/); if (!match || !allowed.has(match[1])) throw new Error("Unrecognized provider setting");
    const value = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value && /[\r\n$]/.test(value)) throw new Error("Unsupported provider credential characters");
    if (value) providers[match[1]] = value;
  }
  if (Boolean(providers.GOOGLE_OAUTH_CLIENT_ID) !== Boolean(providers.GOOGLE_OAUTH_CLIENT_SECRET)) throw new Error("Both Google testing credentials are required");
  if (providers.STRIPE_SECRET_KEY && (!providers.STRIPE_SECRET_KEY.startsWith("sk_test_") || !["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER_MONTHLY", "STRIPE_PRICE_STARTER_ANNUAL"].every((key) => providers[key]))) throw new Error("Stripe sandbox key, webhook secret and both sandbox prices are required; live keys are refused");
  if (!providers.GOOGLE_OAUTH_CLIENT_ID && !providers.STRIPE_SECRET_KEY) throw new Error("No testing credentials supplied");
  state.mode = "providers";
} else if (["up", "run", "mcp"].includes(command)) { state.mode = "fixture"; state.mcp = command === "mcp"; }
// Preserve provider credentials on status/down; never copy them into state.json or receipts.
if (["up", "run", "mcp", "providers"].includes(command)) {
  if (command === "providers" && state.mcp) throw new Error("MCP lab is synthetic-only; switch to ordinary fixture mode before provider setup");
  const values = { DOMI_QA_IMAGE: state.image, DOMI_QA_INTERNAL: state.mode === "fixture" ? "true" : "false", ...Object.fromEntries(Object.entries(state.ports).map(([key, value]) => [`DOMI_QA_${key.toUpperCase()}_PORT`, String(value)])), ...Object.fromEntries(Object.entries(state.secrets).map(([key, value]) => [`DOMI_QA_${key}`, value])) };
  const names = { GOOGLE_OAUTH_CLIENT_ID: "GOOGLE_CLIENT_ID", GOOGLE_OAUTH_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET", GOOGLE_PICKER_API_KEY: "GOOGLE_PICKER_KEY", STRIPE_SECRET_KEY: "STRIPE_KEY", STRIPE_WEBHOOK_SECRET: "STRIPE_WEBHOOK", STRIPE_PRICE_STARTER_MONTHLY: "STRIPE_MONTHLY", STRIPE_PRICE_STARTER_ANNUAL: "STRIPE_ANNUAL" };
  for (const [key, value] of Object.entries(providers)) values[`DOMI_QA_${names[key]}`] = value;
  values.DOMI_QA_STRIPE_MODE = providers.STRIPE_SECRET_KEY ? "sandbox" : "fixture";
  values.DOMI_QA_MCP = state.mcp ? "true" : "false";
  values.DOMI_QA_MCP_GROK_BOT = state.mcp && state.grokBot ? "true" : "false";
  values.DOMI_QA_MCP_READ_SCOPES = state.grokBot ? "shopping:read,chores:read" : "shopping:read,chores:read,notes:read";
  values.DOMI_QA_API_NODE_ENV = state.mcp ? "test" : "production";
  values.DOMI_QA_APP_ORIGIN = state.mcpOrigin ?? localOrigin;
  values.DOMI_QA_MCP_PUBLIC_ORIGIN = publicMcp ? state.mcpOrigin : "";
  values.DOMI_QA_MCP_EGRESS_INTERNAL = publicMcp ? "false" : "true";
  await writeFile(envPath, Object.entries(values).map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`).join("\n") + "\n", { mode: 0o600 });
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}
await execute("docker", ["compose", "version"], true);
async function owned() {
  const ids = (await execute("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], true)).split(/\s+/).filter(Boolean);
  const containers = ids.length ? JSON.parse(await execute("docker", ["inspect", ...ids], true)) : [];
  for (const item of containers) if (item.Config.Labels["com.docker.compose.project.config_files"] !== join(root, "docker-compose.qa.yml") && resolve(item.Config.Labels["com.docker.compose.project.config_files"] ?? "") !== join(root, "docker-compose.qa.yml")) throw new Error("Existing project belongs to a different Compose file");
  const names = (await execute("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], true)).split(/\s+/).filter(Boolean);
  if (names.length) assertVolumes(JSON.parse(await execute("docker", ["volume", "inspect", ...names], true)), project);
  return Boolean(ids.length || names.length);
}
const origins = Object.fromEntries(["web", "www", "mail", "provider"].map((name) => [name, `http://localhost:${state.ports[name]}`]));
async function ready(url, seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (response.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function start() {
  const resourcesExist = await owned();
  if (!resourcesExist) await checkPorts(state.ports);
  // Inspect actual state: a prior interrupted mode switch may not have rebuilt it.
  const network = await execute("docker", ["network", "inspect", `${project}_qa`], true).then((out) => JSON.parse(out)[0]).catch(() => null);
  if (network && network.Labels?.["com.docker.compose.project"] !== project) throw new Error("Network ownership mismatch");
  if (network && network.Internal !== (state.mode === "fixture")) await compose(["down", "--remove-orphans"]);
  if (!process.argv.includes("--no-build")) await compose(["build", "tools"]);
  await compose(["up", "-d", "--wait", "postgres", "archive", "redis", "minio", "mail", "providers", "gateway"]);
  await ready(`${origins.provider}/healthz`);
  await compose(["run", "--rm", "tools", "node", "scripts/hosted-qa/setup.mjs"]);
  if (state.mcp) await compose(["run", "--rm", "tools", "node", "scripts/mcp-chatgpt/setup.mjs"]);
  await compose(["up", "-d", "api", "worker", "web", "www"]);
  for (const url of [`${origins.web}/api/healthz`, `${origins.web}/login`, `${origins.www}/pricing`, `${origins.mail}/api/v1/messages`]) await ready(url);
  console.log(`\nHosted QA (${state.mode})\nApp: ${origins.web}\nMarketing: ${origins.www}\nEmail inbox: ${origins.mail}\nFixture guide: ${origins.provider}\nUse status, test, down or reset commands. Production and dogfood are separate.`);
}
if (["down", "reset"].includes(command)) {
  if (await owned()) await compose(["down", ...(command === "reset" ? ["--volumes"] : []), "--remove-orphans"]);
  if (command === "reset") { state.mode = "fixture"; state.mcp = false; delete state.mcpOrigin; delete state.grokBot; await writeFile(statePath, JSON.stringify(state, null, 2)); console.log("Only this harness project's containers and named volumes were reset. Receipts retained."); }
} else if (command === "status") await compose(["ps"]);
else if (command === "logs") await compose(["logs", "--tail", "80"]);
else {
  if (command !== "test") await start();
  if (["run", "test"].includes(command)) {
    if (state.mode !== "fixture") throw new Error("Automated tests require fixture mode. Run qa:hosted:up to switch back; real provider acceptance is manual.");
    if (!await owned()) throw new Error("Start the owned QA stack before running tests");
    const startedAt = new Date().toISOString();
    const reportDirectory = join(directory, "runs", startedAt.replaceAll(/[:.]/g, "-")); await mkdir(reportDirectory, { recursive: true });
    const report = {
      startedAt, project, mode: "fixture", origins,
      repository: {
        branch: await execute("git", ["branch", "--show-current"], true).catch(() => null),
        commit: await execute("git", ["rev-parse", "HEAD"], true).catch(() => null),
        modified: Boolean(await execute("git", ["status", "--porcelain"], true).catch(() => "unknown")),
      },
      apiImage: await execute("docker", ["inspect", "--format", "{{.Image}}", `${project}-api-1`], true),
      stages: [],
    };
    try {
      await ready(`${origins.web}/api/healthz`, 10);
      await compose(["run", "--rm", "-e", "NODE_ENV=test", "-e", "DATABASE_URL=", "-e", "HOSTED_TEST_DATABASE_URL=", "-e", "HOSTED_ARCHIVE_RESTORE_TEST_DATABASE_URL=", "tools", "npm", "run", "test", "--", "--maxWorkers=4"]);
      report.stages.push({ name: "unit and non-database suite", result: "passed" });
      await compose(["run", "--rm", "-e", "DATABASE_URL=postgresql://domi_ops:" + state.secrets.ADMIN_PASSWORD + "@postgres:5432/domi_ops", "tools", "node", "packages/db/dist/seed-hosted-qa.js"]);
      await compose(["run", "--rm", "-e", "NODE_ENV=test", "-e", "HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:" + state.secrets.APP_PASSWORD + "@postgres:5432/domi_ops", "-e", "HOSTED_ARCHIVE_RESTORE_TEST_DATABASE_URL=postgresql://domi_ops_app:" + state.secrets.APP_PASSWORD + "@archive:5432/domi_ops", "tools", "npm", "run", "test:hosted", "--", "--maxWorkers=4"]);
      report.stages.push({ name: "hosted integration suite", result: "passed" });
      await runBrowserChecks({ origins, token: state.secrets.TOKEN, directory: reportDirectory, report });
      const output = await compose(["run", "--rm", "tools", "node", "scripts/hosted-qa/checks.mjs"], true);
      report.stages.push({ name: "database role, worker and archive checks", result: "passed", evidence: JSON.parse(output) });
      report.result = "passed";
    } catch (error) {
      report.result = "failed"; report.error = error.message;
      await writeFile(join(reportDirectory, "services.log"), await compose(["logs", "--no-color", "--tail", "100"], true).catch(String));
      process.exitCode = 1;
    } finally {
      report.finishedAt = new Date().toISOString();
      await writeFile(join(reportDirectory, "report.json"), JSON.stringify(report, null, 2));
      console.log(`\nQA ${report.result}. Receipt: ${join(reportDirectory, "report.json")}`);
      if (report.error) console.error(report.error);
    }
  }
}

async function checkPorts(ports) {
  for (const port of Object.values(ports)) await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is occupied. Choose DOMI_QA_BASE_PORT before initial setup.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}
