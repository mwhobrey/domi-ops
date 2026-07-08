import type { DriveEmbedObject } from "./drive-types";

/** Matches `[[drive:uuid]]` or `[[drive:uuid|label]]` (label optional). */
export const DRIVE_EMBED_PATTERN = /\[\[drive:([^\]|]+)(?:\|([^\]]*))?\]\]/gi;

export const DRIVE_EMBED_LINK_PREFIX = "domi-ops-drive://";
export const DRIVE_EMBED_MISSING_PREFIX = "domi-ops-drive-missing://";

const IMAGE_FILENAME_PATTERN = /\.(gif|jpe?g|png|webp|svg)$/i;

function nameLooksLikeImage(name: string): boolean {
  return IMAGE_FILENAME_PATTERN.test(name.trim());
}

export function isDriveEmbedImage(
  obj: DriveEmbedObject | null | undefined,
  label?: string,
): boolean {
  if (label?.trim() && nameLooksLikeImage(label)) return true;
  if (!obj || obj.kind !== "file") return false;
  if (obj.contentType?.startsWith("image/")) return true;
  const name = obj.filename ?? obj.title ?? "";
  return nameLooksLikeImage(name);
}

function isDriveEmbedToken(text: string): boolean {
  const re = new RegExp(`^${DRIVE_EMBED_PATTERN.source}$`, "i");
  return re.test(text.trim());
}

/** Unescape TipTap inline-code markdown for a drive embed token. */
function normalizeEscapedDriveEmbedToken(inner: string): string {
  return inner.replace(/\\([\[\]|\\])/g, "$1").trim();
}

/** TipTap may emit escaped `\\[\\[drive:…\\]\\]` outside inline code. */
const ESCAPED_PLAIN_DRIVE_EMBED =
  /\\\[\\\[drive:((?:\\.|[^\]\\])*)(?:\\\|((?:\\.|[^\\]*?))?)?\\\]\\\]/gi;

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

/**
 * Normalize markdown before render or embed-id parsing — undo Rich-editor inline-code
 * shielding (and TipTap escapes) so `[[drive:uuid|label]]` preprocess can match.
 */
export function prepareMarkdownSourceForRender(source: string): string {
  let out = unshieldDriveEmbedsFromRichEditor(source);
  out = out.replace(/`([^`\n]+)`/g, (match, inner: string) => {
    const normalized = normalizeEscapedDriveEmbedToken(inner);
    return isDriveEmbedToken(normalized) ? normalized : match;
  });
  out = unescapePlainDriveEmbedTokens(out);
  return out;
}

export function contentHasDriveEmbeds(content: string): boolean {
  const prepared = prepareMarkdownSourceForRender(content);
  const re = new RegExp(DRIVE_EMBED_PATTERN.source, "i");
  return re.test(prepared);
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

export function formatDriveEmbed(objectId: string, label?: string): string {
  const id = objectId.trim();
  const text = label?.trim();
  return text ? `[[drive:${id}|${text}]]` : `[[drive:${id}]]`;
}

export function insertDriveEmbed(content: string, objectId: string, label?: string): string {
  const embed = formatDriveEmbed(objectId, label);
  const trimmed = content.trimEnd();
  if (!trimmed) return embed;
  const separator = trimmed.endsWith("\n") ? "" : "\n";
  return `${trimmed}${separator}${embed}`;
}

function driveEmbedPattern(): RegExp {
  return new RegExp(DRIVE_EMBED_PATTERN.source, "gi");
}

/** TipTap Link autolink eats `drive:uuid`; wrap embeds in inline code for rich editing. */
const RICH_EDITOR_SHIELDED_EMBED = /`(\[\[drive:[^\]]+\]\])`/gi;

export function shieldDriveEmbedsForRichEditor(source: string): string {
  if (!contentHasDriveEmbeds(source)) return source;
  return source.replace(driveEmbedPattern(), (match) => `\`${match}\``);
}

export function unshieldDriveEmbedsFromRichEditor(source: string): string {
  return source.replace(RICH_EDITOR_SHIELDED_EMBED, "$1");
}

export function preprocessDriveEmbedsForMarkdown(
  source: string,
  resolutions: Record<string, DriveEmbedObject | undefined>,
): string {
  const prepared = prepareMarkdownSourceForRender(source);
  return prepared.replace(driveEmbedPattern(), (_match, rawId: string, rawLabel?: string) => {
    const id = rawId.trim();
    const label = rawLabel?.trim();
    const obj = resolutions[id];
    const display = label || obj?.title || "Drive file";
    const escaped = display.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    const href = `${DRIVE_EMBED_LINK_PREFIX}${id}`;
    const asImage = isDriveEmbedImage(obj, label);
    if (!obj) {
      if (asImage) return `![${escaped}](${href})`;
      return `[${escaped}](${DRIVE_EMBED_MISSING_PREFIX}${id})`;
    }
    if (asImage) {
      return `![${escaped}](${href})`;
    }
    return `[${escaped}](${href})`;
  });
}
