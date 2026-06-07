import { drizzle } from "drizzle-orm/postgres-js";
import postgresLib from "postgres";
import * as schema from "./schema/index.js";

const clients = new WeakMap<ReturnType<typeof drizzle>, ReturnType<typeof postgresLib>>();

export function createDb(connectionString: string) {
  const client = postgresLib(connectionString, { max: 10 });
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
