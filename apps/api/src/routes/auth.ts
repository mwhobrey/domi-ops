import { Hono } from "hono";
import { resolveAuthContext, type WhomeBetterAuth } from "@domi-ops/auth";
import { filterActiveHouseholdModules } from "@domi-ops/config";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import { memberAvatarUrl } from "../lib/avatar-url.js";
import { getHouseholdModuleContext } from "../lib/household-entitlements.js";
import type { AppVariables } from "../middleware/auth.js";

/** Whome session DTO — household member context on top of Better Auth user. */
export function whomeSessionRoutes(db: Database, env: Env, auth: WhomeBetterAuth) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/session", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.json({ authenticated: false });
    }

    const authCtx = await resolveAuthContext(db, session.user.id);
    if (!authCtx) {
      return c.json({ authenticated: false });
    }

    const [memberRow] = await db
      .select({ avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(eq(householdMembers.id, authCtx.memberId))
      .limit(1);

    const { modules, modulesEntitled } = await getHouseholdModuleContext(db, authCtx.householdId);

    return c.json({
      authenticated: true,
      modulesEnabled: filterActiveHouseholdModules(env, modules, modulesEntitled),
      modulesEntitled,
      user: {
        id: authCtx.userId,
        email: authCtx.email,
        username: authCtx.username,
        householdId: authCtx.householdId,
        memberId: authCtx.memberId,
        name: authCtx.name,
        role: authCtx.role,
        avatarUrl: memberAvatarUrl(authCtx.memberId, memberRow?.avatarKey),
      },
    });
  });

  return app;
}
