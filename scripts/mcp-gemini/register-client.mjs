import { readFile, writeFile } from "node:fs/promises";
import { createDb, closeDb } from "@domi-ops/db";
import { createBetterAuth } from "@domi-ops/auth";
import { loadEnv } from "@domi-ops/config";
import { assertSyntheticMcpOrigin } from "../hosted-qa/mcp-origin.mjs";
import { geminiRegistration } from "./registration.mjs";

const env = loadEnv();
if (!assertSyntheticMcpOrigin(env).remote) throw new Error("Gemini cloud test requires the public HTTPS synthetic lab");
const [callbackFile, ...extra] = process.argv.slice(2);
if (!callbackFile || extra.length) throw new Error("Usage: register-client.mjs EXACT_OBSERVED_CALLBACK_FILE");
const callback = (await readFile(callbackFile, "utf8")).trim();
const profile = geminiRegistration(callback);
const prior = await readFile("/qa/gemini-client.json", "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
function report(clientId) { console.log(JSON.stringify({ clientId, callbackOrigin: new URL(callback).origin, origin: env.PUBLIC_APP_URL, tokenEndpointAuthMethod: "none", liveGeminiVerified: false })); }
if (prior) {
  if (prior.callback !== callback || prior.origin !== env.PUBLIC_APP_URL) throw new Error("Existing synthetic Gemini client differs; inspect before replacement");
  report(prior.clientId); process.exit(0);
}
const fixture = JSON.parse(await readFile("/qa/fixtures.json", "utf8"));
const owner = fixture.households.find((household) => household.label === "alpha");
const db = createDb(env.DATABASE_URL);
try {
  const auth = createBetterAuth(db, env, { cookiePrefix: process.env.QA_COOKIE_PREFIX });
  const login = await auth.api.signInEmail({ body: { email: owner.email, password: fixture.password }, headers: new Headers({ origin: env.PUBLIC_APP_URL }), asResponse: true });
  if (!login.ok) throw new Error("Synthetic owner login failed");
  const headers = new Headers({ origin: env.PUBLIC_APP_URL, cookie: login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  const client = await auth.mcp.registerClient(headers, profile);
  await writeFile("/qa/gemini-client.json", JSON.stringify({ clientId: client.client_id, callback, origin: env.PUBLIC_APP_URL }, null, 2), { mode: 0o600, flag: "wx" });
  report(client.client_id);
} finally { await closeDb(db); }
