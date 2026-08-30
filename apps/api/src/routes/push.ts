import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  claimEndpointForUser,
  deletePushSubscriptionForUser,
  isWebPushConfigured,
  upsertPushSubscription,
  type PushSubscriptionPayload,
} from "../lib/push-notices.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function pushRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/push/vapid-public-key", async (c) => {
    if (!isWebPushConfigured(env)) {
      return c.json({ enabled: false, publicKey: null });
    }
    return c.json({ enabled: true, publicKey: env.VAPID_PUBLIC_KEY ?? null });
  });

  app.post("/push/subscribe", async (c) => {
    const auth = c.get("auth")!;
    if (!isWebPushConfigured(env)) {
      return c.json({ error: "push_not_configured" }, 503);
    }
    const body = await c.req.json<PushSubscriptionPayload & { timezone?: string }>();
    if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return c.json({ error: "invalid_subscription" }, 400);
    }
    await claimEndpointForUser(db, auth.userId, body.endpoint);
    await upsertPushSubscription(db, auth.userId, body);
    return c.json({ ok: true });
  });

  app.delete("/push/subscribe", async (c) => {
    const auth = c.get("auth")!;
    let endpoint: string | undefined;
    try {
      const body = await c.req.json<{ endpoint?: string }>();
      endpoint = body.endpoint;
    } catch {
      /* no body — remove all subs for user */
    }
    await deletePushSubscriptionForUser(db, auth.userId, endpoint);
    return c.json({ ok: true });
  });

  return app;
}
