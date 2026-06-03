import type { ImportContext, MapperResult } from "./types.js";

export async function importSchool(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  let count = 0;
  try {
    const row = ctx.sqlite
      .prepare("SELECT COUNT(*) as c FROM school_class")
      .get() as { c: number };
    count = row?.c ?? 0;
  } catch {
    result.warnings.push("school_class table not found — skipped");
    return result;
  }
  if (ctx.dryRun) {
    result.imported = count;
    result.warnings.push("dry-run: school import writes classes/assignments (stub for full LMS rows)");
    return result;
  }
  result.warnings.push("school mapper write path: implement full school_* row mapping in v1.1");
  return result;
}
