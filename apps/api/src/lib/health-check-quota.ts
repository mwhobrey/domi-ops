import type { Database } from "@domi-ops/db";
import { lockQuota } from "./health-quota.js";

/**
 * Serialize "count what a person has, then add one" for that person and kind of thing, so two
 * concurrent creates cannot both squeeze past a limit. The mechanics (and why) are in
 * {@link lockQuota}; this fixes the key to the kind and the person, so checks versus groups, and
 * different people, never wait on each other.
 */
export async function lockCheckQuota(db: Database, kind: "checks" | "check-groups", memberId: string): Promise<void> {
  await lockQuota(db, `${kind}:${memberId}`);
}
