import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "./client.js";

type ScopedStore = { tx: Database };

const scopedStore = new AsyncLocalStorage<ScopedStore>();

/** Map scoped proxy → underlying pool db (for starting transactions). */
const baseDbByScoped = new WeakMap<Database, Database>();

/**
 * Proxy that routes drizzle calls to the active transaction when inside
 * `runWithScopedDb` (tenant middleware / manual withHouseholdContext).
 */
export function createScopedDb(baseDb: Database): Database {
  const scoped = new Proxy(baseDb, {
    get(target, prop, receiver) {
      const store = scopedStore.getStore();
      const active = store?.tx ?? target;
      const value = Reflect.get(active, prop, receiver);
      if (typeof value === "function") {
        return value.bind(active);
      }
      return value;
    },
  }) as Database;

  baseDbByScoped.set(scoped, baseDb);
  return scoped;
}

export function getBaseDb(db: Database): Database {
  return baseDbByScoped.get(db) ?? db;
}

export function runWithScopedDb<T>(tx: Database, fn: () => Promise<T>): Promise<T> {
  return scopedStore.run({ tx }, fn);
}
