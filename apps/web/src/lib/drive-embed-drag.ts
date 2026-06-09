import { formatDriveEmbed } from "./drive-embeds";

/** MIME type for dragging Drive attachments into note editors. */
export const DRIVE_EMBED_DRAG_TYPE = "application/x-whome-drive-embed";

export interface DriveEmbedDragPayload {
  id: string;
  label: string;
}

export function driveEmbedInsertLabel(obj: {
  filename?: string | null;
  title: string;
}): string {
  const filename = obj.filename?.trim();
  if (filename) return filename;
  return obj.title.trim();
}

export function encodeDriveEmbedDragPayload(payload: DriveEmbedDragPayload): string {
  return JSON.stringify(payload);
}

export function parseDriveEmbedDragPayload(
  dataTransfer: DataTransfer | null,
): DriveEmbedDragPayload | null {
  if (!dataTransfer) return null;

  const raw = dataTransfer.getData(DRIVE_EMBED_DRAG_TYPE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DriveEmbedDragPayload;
      if (parsed?.id?.trim() && parsed?.label?.trim()) {
        return { id: parsed.id.trim(), label: parsed.label.trim() };
      }
    } catch {
      /* fall through */
    }
  }

  const plain = dataTransfer.getData("text/plain").trim();
  const match = plain.match(/^\[\[drive:([^\]|]+)(?:\|([^\]]*))?\]\]$/i);
  if (match) {
    const id = match[1]?.trim();
    if (!id) return null;
    const label = match[2]?.trim() || "Drive file";
    return { id, label };
  }

  return null;
}

export function driveEmbedDragMimePresent(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return dataTransfer.types.includes(DRIVE_EMBED_DRAG_TYPE);
}

export function driveEmbedMarkdownFromPayload(payload: DriveEmbedDragPayload): string {
  return formatDriveEmbed(payload.id, payload.label);
}
