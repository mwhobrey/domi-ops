import type { ImportContext, MapperResult } from "./types.js";

export async function importFiles(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  let count = 0;
  try {
    const row = ctx.sqlite.prepare("SELECT COUNT(*) as c FROM file").get() as { c: number };
    count = row?.c ?? 0;
  } catch {
    result.warnings.push("file table not found");
    return result;
  }
  if (ctx.dryRun) {
    result.imported = count;
    result.warnings.push(
      `dry-run: would copy ${count} files to S3${ctx.uploadsPath ? ` from ${ctx.uploadsPath}` : ""}`,
    );
    return result;
  }
  result.warnings.push("files mapper: S3 upload not implemented in v1 — metadata only planned");
  return result;
}
