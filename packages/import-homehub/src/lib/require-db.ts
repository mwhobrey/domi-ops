import type { ImportContext } from "../mappers/types.js";

export function requireDb(ctx: ImportContext) {
  if (!ctx.db) {
    throw new Error("ImportContext.db required for live import");
  }
  return ctx.db;
}
