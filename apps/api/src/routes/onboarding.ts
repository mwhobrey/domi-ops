import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers } from "@domi-ops/db";
import { requireAuth, type AppVariables } from "../middleware/auth.js";

/**
 * First-login checklist state (apps/web/src/components/OnboardingChecklist.tsx).
 * Server-side and per-member so progress follows the person across whatever device
 * or platform they pick up Domi Ops on next, not just the browser tab they started in.
 */
export function onboardingRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const [row] = await db
      .select({
        stepsDone: householdMembers.onboardingStepsDone,
        dismissedAt: householdMembers.onboardingDismissedAt,
      })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);

    let stepsDone: string[] = [];
    try {
      stepsDone = row?.stepsDone ? (JSON.parse(row.stepsDone) as string[]) : [];
    } catch {
      stepsDone = [];
    }

    return c.json({ stepsDone, dismissed: Boolean(row?.dismissedAt) });
  });

  app.patch("/", async (c) => {
    const auth = c.get("auth")!;
    let body: { stepsDone?: unknown; dismissed?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const update: Partial<typeof householdMembers.$inferInsert> = {};
    if (Array.isArray(body.stepsDone) && body.stepsDone.every((s) => typeof s === "string")) {
      update.onboardingStepsDone = JSON.stringify(body.stepsDone);
    }
    if (typeof body.dismissed === "boolean") {
      update.onboardingDismissedAt = body.dismissed ? new Date() : null;
    }
    if (Object.keys(update).length === 0) {
      return c.json({ error: "no_valid_fields" }, 400);
    }

    await db.update(householdMembers).set(update).where(eq(householdMembers.id, auth.memberId));

    return c.json({ ok: true });
  });

  return app;
}
