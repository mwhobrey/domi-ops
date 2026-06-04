import DOMPurify from "isomorphic-dompurify";

const EVENT_HTML_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "span",
  "div",
] as const;

const EVENT_HTML_ATTR = ["href", "target", "rel", "class"] as const;

export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

/** Sanitize HTML stored on calendar events (Google import + rich editor). */
export function sanitizeEventHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...EVENT_HTML_TAGS],
    ALLOWED_ATTR: [...EVENT_HTML_ATTR],
    ALLOW_DATA_ATTR: false,
  }).trim();
}

/** Plain-text preview for agenda rows and truncation. */
export function eventDescriptionPlainText(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const trimmed = value.trim();
  if (!looksLikeHtml(trimmed)) return trimmed;
  const sanitized = sanitizeEventHtml(trimmed);
  return (
    sanitized
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function isEmptyEventHtml(html: string): boolean {
  const plain = eventDescriptionPlainText(html);
  return plain.length === 0;
}

export function normalizeEventDescriptionForSave(html: string): string | undefined {
  const sanitized = sanitizeEventHtml(html);
  if (isEmptyEventHtml(sanitized)) return undefined;
  return sanitized;
}
