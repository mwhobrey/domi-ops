import { readFile, writeFile } from "node:fs/promises";
import { createDb, closeDb } from "@domi-ops/db";
import { createBetterAuth } from "@domi-ops/auth";
import { loadEnv } from "@domi-ops/config";
import { assertSyntheticMcpOrigin } from "../hosted-qa/mcp-origin.mjs";

const env = loadEnv();
if (!assertSyntheticMcpOrigin(env).remote) throw new Error("Claude cloud test requires the public HTTPS synthetic lab");
const callback = "https://claude.ai/api/mcp/auth_callback";
const prior = await readFile("/qa/claude-client.json", "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
if (prior) {
  if (prior.callback !== callback || prior.origin !== env.PUBLIC_APP_URL) throw new Error("Existing synthetic Claude client differs; inspect before replacement");
  console.log(JSON.stringify(prior));
  process.exit(0);
}
const fixture = JSON.parse(await readFile("/qa/fixtures.json", "utf8"));
const owner = fixture.households.find((household) => household.label === "alpha");
const db = createDb(env.DATABASE_URL);
try {
  const auth = createBetterAuth(db, env, { cookiePrefix: process.env.QA_COOKIE_PREFIX });
  const login = await auth.api.signInEmail({ body: { email: owner.email, password: fixture.password }, headers: new Headers({ origin: env.PUBLIC_APP_URL }), asResponse: true });
  if (!login.ok) throw new Error("Synthetic owner login failed");
  const headers = new Headers({ origin: env.PUBLIC_APP_URL, cookie: login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  const client = await auth.mcp.registerClient(headers, {
    name: "Claude synthetic household test", redirectUris: [callback], tokenEndpointAuthMethod: "none",
    scopes: ["shopping:read", "chores:read", "notes:read", "offline_access"],
    provider: "claude", profileVersion: "who-476.claude.synthetic.v1", dataMode: "synthetic", enabled: true,
  });
  const result = { clientId: client.client_id, callback, origin: env.PUBLIC_APP_URL, tokenEndpointAuthMethod: "none", liveClaudeVerified: false };
  await writeFile("/qa/claude-client.json", JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(result));
} finally { await closeDb(db); }
