import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@domi-ops/db";
import { healthCheckPauses } from "@domi-ops/db";

/**
 * Record an `enabled` flip on a health check as a pause period, like medications (WHO-338).
 * Pausing opens a period; resuming closes every open one. No-op when the flag didn't change.
 */
export async function recordCheckEnabledChange(
  db: Database,
  checkId: string,
  wasEnabled: boolean,
  nowEnabled: boolean,
  at: Date = new Date(),
): Promise<void> {
  if (wasEnabled === nowEnabled) return;
  if (!nowEnabled) {
    await db.insert(healthCheckPauses).values({ checkId, pausedAt: at });
    return;
  }
  await db
    .update(healthCheckPauses)
    .set({ resumedAt: at })
    .where(and(eq(healthCheckPauses.checkId, checkId), isNull(healthCheckPauses.resumedAt)));
}
