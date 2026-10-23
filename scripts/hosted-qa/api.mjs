import { serve } from "@hono/node-server";
import Stripe from "stripe";
import { loadEnv } from "@domi-ops/config";
import { createApplication } from "../../apps/api/dist/app.js";
import { ensureS3ReadyOnce } from "../../apps/api/dist/lib/s3.js";
import { createServer, connect } from "node:net";
import { assertSyntheticMcpOrigin } from "./mcp-origin.mjs";

if (process.env.QA_TOKEN?.length !== 64 || !process.env.DATABASE_URL?.includes("@postgres:5432/domi_ops")) throw new Error("Harness configuration required");
const env = loadEnv();
if (env.MCP_ENABLED) {
  const { remote } = assertSyntheticMcpOrigin(env);
  const origin = new URL(env.PUBLIC_APP_URL);
  // The provider verifies tokens using the canonical public JWKS URL. Inside
  // this isolated container, loopback must reach the same gateway as the browser.
  if (!remote) createServer((socket) => {
    const upstream = connect(3000, "gateway");
    socket.on("error", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy()); upstream.on("close", () => socket.destroy());
    socket.pipe(upstream); upstream.pipe(socket);
  }).listen(Number(origin.port), "127.0.0.1");
}
const fixture = process.env.QA_STRIPE_MODE === "fixture";
if (!fixture && !env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Only Stripe sandbox keys are allowed");
const app = createApplication(env, { authCookiePrefix: process.env.QA_COOKIE_PREFIX, ...(fixture ? { stripeFactory: (key) => new Stripe(key, { host: "providers", port: 4080, protocol: "http" }) } : {}) });
await ensureS3ReadyOnce(env);
serve({ fetch: app.fetch, port: 4000 });
console.log(`Hosted QA API ready (${fixture ? "local Stripe simulator" : "Stripe sandbox"}; real authentication and RLS)`);
