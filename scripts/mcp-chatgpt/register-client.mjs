import { readFile, writeFile } from "node:fs/promises";
import { createDb, closeDb } from "@domi-ops/db";
import { createBetterAuth } from "@domi-ops/auth";
import { loadEnv } from "@domi-ops/config";

const env = loadEnv();
if (!env.MCP_ENABLED || !env.MCP_SYNTHETIC_DEPLOYMENT || env.NODE_ENV !== "test" ||
    process.env.QA_TOKEN?.length !== 64 || !env.DATABASE_URL.includes("@postgres:5432/domi_ops") ||
    !/^http:\/\/localhost:\d+$/.test(env.PUBLIC_APP_URL)) throw new Error("Owned loopback synthetic MCP lab required");
const callback = process.argv[2];
const redirect = new URL(callback);
if (redirect.origin !== "https://chatgpt.com" || redirect.username || redirect.password || redirect.search || redirect.hash ||
    !/^\/(?:connector\/oauth\/[A-Za-z0-9_-]+|connector_platform_oauth_redirect)$/.test(redirect.pathname)) {
  throw new Error("Copy the exact ChatGPT callback from its connection management UI");
}
const prior = await readFile("/qa/chatgpt-client.json", "utf8").then(JSON.parse).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (prior) {
  if (prior.callback !== callback || prior.origin !== env.PUBLIC_APP_URL) throw new Error("Existing synthetic ChatGPT client differs; inspect it before replacement");
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
    name: "ChatGPT synthetic household test", redirectUris: [callback], tokenEndpointAuthMethod: "none",
    scopes: ["shopping:read", "chores:read", "notes:read", "offline_access"],
    provider: "chatgpt", profileVersion: "who-475.chatgpt.synthetic.v1", dataMode: "synthetic", enabled: true,
  });
  const result = { clientId: client.client_id, callback, origin: env.PUBLIC_APP_URL, tokenEndpointAuthMethod: "none", liveChatGPTVerified: false };
  await writeFile("/qa/chatgpt-client.json", JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(result));
} finally { await closeDb(db); }
