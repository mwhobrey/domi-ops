import type { AuthContext } from "@whome/auth";
import type { Database } from "@whome/db";
import { driveObjects } from "@whome/db";
import { and, inArray } from "drizzle-orm";
import { driveVisibleWhere, filenameFromDriveKey } from "./drive.js";

/** Matches `[[drive:uuid]]` or `[[drive:uuid|label]]` (label optional). */
export const DRIVE_EMBED_PATTERN = /\[\[drive:([^\]|]+)(?:\|([^\]]*))?\]\]/gi;

export type DriveEmbedDto = {
  id: string;
  title: string;
  kind: string;
  filename: string | null;
  url: string | null;
  contentType: string | null;
};

const RICH_EDITOR_SHIELDED_EMBED = /`(\[\[drive:[^\]]+\]\])`/gi;

function isDriveEmbedToken(text: string): boolean {
  const re = new RegExp(`^${DRIVE_EMBED_PATTERN.source}$`, "i");
  return re.test(text.trim());
}

function normalizeEscapedDriveEmbedToken(inner: string): string {
  return inner.replace(/\\([\[\]|\\])/g, "$1").trim();
}

const ESCAPED_PLAIN_DRIVE_EMBED =
  /\\\[\\\[drive:((?:\\.|[^\]\\])*)(?:\\\|((?:\\.|[^\\]*?))?)?\\\]\\\]/gi;

function unshieldDriveEmbedsFromRichEditor(source: string): string {
  return source.replace(RICH_EDITOR_SHIELDED_EMBED, "$1");
}

function unescapePlainDriveEmbedTokens(source: string): string {
  return source.replace(
    ESCAPED_PLAIN_DRIVE_EMBED,
    (_match, rawId: string, rawLabel?: string) => {
      const id = normalizeEscapedDriveEmbedToken(rawId);
      const label = rawLabel ? normalizeEscapedDriveEmbedToken(rawLabel) : undefined;
      return label ? `[[drive:${id}|${label}]]` : `[[drive:${id}]]`;
    },
  );
}

/** Unwrap Rich-editor shields before parsing embed ids from stored note content. */
export function prepareMarkdownSourceForRender(source: string): string {
  let out = unshieldDriveEmbedsFromRichEditor(source);
  out = out.replace(/`([^`\n]+)`/g, (match, inner: string) => {
    const normalized = normalizeEscapedDriveEmbedToken(inner);
    return isDriveEmbedToken(normalized) ? normalized : match;
  });
  out = unescapePlainDriveEmbedTokens(out);
  return out;
}

export function parseDriveEmbedIds(content: string): string[] {
  const prepared = prepareMarkdownSourceForRender(content);
  const ids = new Set<string>();
  const re = new RegExp(DRIVE_EMBED_PATTERN.source, "gi");
  for (const match of prepared.matchAll(re)) {
    const id = match[1]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function driveEmbedsForContent(
  content: string,
  resolved: Map<string, DriveEmbedDto>,
): Record<string, DriveEmbedDto> {
  const out: Record<string, DriveEmbedDto> = {};
  for (const id of parseDriveEmbedIds(content)) {
    const obj = resolved.get(id);
    if (obj) out[id] = obj;
  }
  return out;
}

export async function loadDriveEmbedObjects(
  db: Database,
  auth: AuthContext,
  ids: string[],
): Promise<Map<string, DriveEmbedDto>> {
  const map = new Map<string, DriveEmbedDto>();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return map;

  const rows = await db
    .select({
      id: driveObjects.id,
      title: driveObjects.title,
      kind: driveObjects.kind,
      url: driveObjects.url,
      s3Key: driveObjects.s3Key,
      contentType: driveObjects.contentType,
    })
    .from(driveObjects)
    .where(and(inArray(driveObjects.id, unique), driveVisibleWhere(db, auth)));

  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      title: row.title,
      kind: row.kind,
      filename: row.s3Key ? filenameFromDriveKey(row.s3Key) : null,
      url: row.url,
      contentType: row.contentType,
    });
  }
  return map;
}
