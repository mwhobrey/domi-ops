import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import { withMcpProviderContext, type Database } from "@domi-ops/db";

/** Only provider models enter the credential role. Identity/session models keep
 * the existing adapter and privileges; no domain query runs under this role. */
export function mcpAuthAdapter(db: Database, schema: NonNullable<Parameters<typeof drizzleAdapter>[1]["schema"]>, providerModels: Set<string>) {
  return (options: BetterAuthOptions) => {
    const make = (connection: Database): ReturnType<ReturnType<typeof drizzleAdapter>> => {
      const adapter = drizzleAdapter(connection, { provider: "pg", schema, transaction: true })(options);
      return new Proxy(adapter, {
        get(target, property) {
          if (property === "transaction") {
            return <T>(callback: (adapter: ReturnType<typeof make>) => Promise<T>) => connection.transaction((tx) => callback(make(tx as unknown as Database)));
          }
          const method = Reflect.get(target, property);
          if (typeof method !== "function") return method;
          return (input: { model?: string }) => {
            if (!input?.model || !providerModels.has(input.model)) return Reflect.apply(method, target, [input]);
            return withMcpProviderContext(connection, async (tx) => {
              const scoped = drizzleAdapter(tx, { provider: "pg", schema, transaction: true })(options);
              return Reflect.apply(Reflect.get(scoped, property), scoped, [input]);
            });
          };
        },
      });
    };
    return make(db);
  };
}
