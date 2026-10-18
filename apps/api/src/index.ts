import { serve } from "@hono/node-server";
import { loadEnv } from "@domi-ops/config";
import { createApplication } from "./app.js";
import { initSentry } from "./lib/sentry.js";
import { ensureS3ReadyOnce } from "./lib/s3.js";

const env = loadEnv();
initSentry(env);
const app = createApplication(env);
const port = Number(process.env.PORT ?? 4000);
if (env.S3_ENDPOINT) {
  void ensureS3ReadyOnce(env).catch((err) => {
    console.warn("[domi-ops s3] bucket/CORS setup failed:", err instanceof Error ? err.message : err);
  });
}
console.log(`domi-ops api listening on :${port} (${env.DEPLOYMENT_MODE})`);
serve({ fetch: app.fetch, port });
