import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/** Fixed SECURITY DEFINER deletion function, never a tenant content scan. */
export async function pruneMcpMetadata(db: Database) {
  let deleted = 0;
  for (let batch = 0; batch < 8; batch++) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '5000ms', true), set_config('lock_timeout', '1000ms', true)`);
      const [row] = await tx.execute<{ deleted: number }>(sql`select app.mcp_prune_expired_metadata() as deleted`);
      return row;
    });
    deleted += result.deleted;
    if (!result.deleted) break;
  }
  return deleted;
}
