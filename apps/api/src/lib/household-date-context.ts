import { AsyncLocalStorage } from "node:async_hooks";

const dates = new AsyncLocalStorage<string>();

/** One household calendar date per request, isolated across concurrent tenants. */
export function withHouseholdDate<T>(today: string, fn: () => T): T {
  return dates.run(today, fn);
}

export function currentHouseholdDate() {
  return dates.getStore() ?? new Date().toISOString().slice(0, 10);
}
