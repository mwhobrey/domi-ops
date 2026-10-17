import type { Context, Next } from "hono";
import type { Env } from "@domi-ops/config";

/** A public fictional household must not connect visitors' real accounts or send mail/payments. */
export function createDemoProtectionMiddleware(env: Env) {
  return async (c: Context, next: Next) => {
    if (!env.DEMO_MODE) return next();
    const path = c.req.path;
    const write = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    const externalFlow = path.startsWith("/auth/google/") || path.startsWith("/auth/callback/") || path === "/auth/sign-in/social" || path.startsWith("/api/integrations/withings/");
    const protectedWrite = write && ["/api/billing/", "/api/invitations/", "/api/core/household/invitations", "/api/health/withings/", "/api/health/myallyfile/", "/api/core/native-auth/social", "/api/core/profile/account"].some((prefix) => path.startsWith(prefix));
    const memberRemoval = c.req.method === "DELETE" && path.startsWith("/api/core/household/members/");
    if (externalFlow || protectedWrite || memberRemoval) return c.json({ error: "demo_action_unavailable", message: "The shared demo uses fictional records. Use your own household to connect accounts, invite people, manage billing or remove access." }, 403);
    if (write && ["/api/core/reports/export", "/api/core/weekly-reports/export"].includes(path)) {
      const body = await c.req.json<{ destination?: string }>().catch(() => null);
      if (body?.destination && !["preview", "domi-ops-drive"].includes(body.destination)) return c.json({ error: "demo_external_export_unavailable" }, 403);
    }
    return next();
  };
}
