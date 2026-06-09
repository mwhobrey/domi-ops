import { formatDriveEmbed } from "./drive-embeds";

export interface DriveEmbedTrigger {
  /** Index of the first `[` in `[[`. */
  start: number;
  /** Cursor / end of the active fragment. */
  end: number;
  /** Query sent to Drive list API (`drive:` prefix and label stripped). */
  searchQuery: string;
}

const TRIGGER_TERMINATOR = /[\]\s\n]/;

/** Detect an open `[[…` wiki-link fragment at `cursor` (not yet closed with `]]`). */
export function findDriveEmbedTrigger(text: string, cursor: number): DriveEmbedTrigger | null {
  if (cursor < 2) return null;
  const before = text.slice(0, cursor);
  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen === -1) return null;

  const fragment = before.slice(lastOpen + 2);
  if (fragment.includes("]]")) return null;
  if (TRIGGER_TERMINATOR.test(fragment)) return null;

  let searchQuery = fragment;
  if (searchQuery.toLowerCase().startsWith("drive:")) {
    searchQuery = searchQuery.slice(6);
  }
  const pipeIdx = searchQuery.indexOf("|");
  if (pipeIdx !== -1) {
    searchQuery = searchQuery.slice(0, pipeIdx);
  }

  return { start: lastOpen, end: cursor, searchQuery };
}

export function applyDriveEmbedSelection(
  text: string,
  trigger: DriveEmbedTrigger,
  objectId: string,
  label: string,
): { text: string; cursor: number } {
  const embed = formatDriveEmbed(objectId, label);
  const next = text.slice(0, trigger.start) + embed + text.slice(trigger.end);
  return { text: next, cursor: trigger.start + embed.length };
}

const CARET_MIRROR_STYLE_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "MozTabSize",
] as const;

/** Screen coordinates for a caret index inside a textarea (for popover anchoring). */
export function getTextareaCaretScreenPosition(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";

  for (const prop of CARET_MIRROR_STYLE_PROPS) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }

  const value = textarea.value;
  mirror.textContent = value.substring(0, position);
  const marker = document.createElement("span");
  marker.textContent = value.substring(position) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const rect = textarea.getBoundingClientRect();
  const top = rect.top + marker.offsetTop - textarea.scrollTop;
  const left = rect.left + marker.offsetLeft - textarea.scrollLeft;
  const height = marker.offsetHeight || parseFloat(style.lineHeight) || 16;

  document.body.removeChild(mirror);
  return { top, left, height };
}
