import { readFile, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { createDb, closeDb, withHouseholdContext, shoppingItems, chores } from "@domi-ops/db";
import { createBetterAuth } from "@domi-ops/auth";
import { loadEnv } from "@domi-ops/config";
import { assertSyntheticMcpOrigin } from "../hosted-qa/mcp-origin.mjs";

// This operator entry point is shipped only in the owned QA tools image.
const env = loadEnv();
assertSyntheticMcpOrigin(env);
const fixture = JSON.parse(await readFile("/qa/fixtures.json", "utf8"));
const prior = await readFile("/qa/mcp.json", "utf8").then(JSON.parse).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
if (prior) { console.log("Existing synthetic MCP client retained; consent still required."); process.exit(0); }
const db = createDb(env.DATABASE_URL);
try {
  const auth = createBetterAuth(db, env, { cookiePrefix: process.env.QA_COOKIE_PREFIX });
  const alpha = fixture.households.find((household) => household.label === "alpha");
  const response = await auth.api.signInEmail({ body: { email: alpha.email, password: fixture.password }, headers: new Headers({ origin: env.PUBLIC_APP_URL }), asResponse: true });
  if (!response.ok) throw new Error("Synthetic owner login failed");
  const headers = new Headers({ origin: env.PUBLIC_APP_URL, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  for (const household of fixture.households) {
    await withHouseholdContext(db, household.householdId, async (tx) => {
      if (!(await tx.select({ id: shoppingItems.id }).from(shoppingItems).where(eq(shoppingItems.householdId, household.householdId))).length) await tx.insert(shoppingItems).values({ householdId: household.householdId, item: `${household.label} synthetic apples`, quantity: 2, unit: "bags" });
      if (!(await tx.select({ id: chores.id }).from(chores).where(eq(chores.householdId, household.householdId))).length) await tx.insert(chores).values({ householdId: household.householdId, description: `${household.label} synthetic tidy task`, dueDate: "2026-10-22", assigneeMemberId: household.memberId });
    });
  }
  await auth.mcp.setHouseholdEnabled(headers, alpha.householdId, true);
  // The provider requires a non-loopback HTTPS web callback. The smoke captures
  // the reserved test-domain redirect and never navigates or sends data there.
  const callback = "https://client.example.test/callback";
  const client = await auth.mcp.registerClient(headers, { name: "Local synthetic MCP inspector", redirectUris: [callback], tokenEndpointAuthMethod: "none", scopes: ["shopping:read", "chores:read", "notes:read", "offline_access"], provider: "local", profileVersion: "who-475.synthetic.v1", dataMode: "synthetic", enabled: true });
  await writeFile("/qa/mcp.json", JSON.stringify({ clientId: client.client_id, callback, householdId: alpha.householdId, noteId: alpha.noteId, origin: env.PUBLIC_APP_URL, liveChatGPTVerified: false }, null, 2), { mode: 0o600 });
  console.log("Synthetic shopping/chores and local public OAuth client ready; no member grant or ChatGPT connection created.");
} finally { await closeDb(db); }
