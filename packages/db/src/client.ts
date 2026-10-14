import { drizzle } from "drizzle-orm/postgres-js";
import postgresLib from "postgres";
import * as schema from "./schema/index.js";

const clients = new WeakMap<ReturnType<typeof drizzle>, ReturnType<typeof postgresLib>>();

/**
 * Connections per pool. Ten by default; `DB_POOL_MAX` overrides it. Every authenticated API request holds
 * one of these for its whole duration (the tenant transaction), so this is also the ceiling on concurrent
 * authenticated requests.
 */
function poolMax(): number {
  const n = Number(process.env.DB_POOL_MAX);
  return Number.isInteger(n) && n >= 1 ? n : 10;
}

export function createDb(connectionString: string) {
  const client = postgresLib(connectionString, { max: poolMax() });
  const db = drizzle(client, { schema });
  clients.set(db, client);
  return db;
}

/** Release postgres.js pool — required for CLI scripts to exit. */
export async function closeDb(db: ReturnType<typeof createDb>): Promise<void> {
  const client = clients.get(db);
  if (!client) return;
  clients.delete(db);
  await client.end({ timeout: 5 });
}

export type Database = ReturnType<typeof createDb>;
