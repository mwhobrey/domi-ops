import type { NoteVisibility } from "./note-visibility";

export interface DriveObject {
  id: string;
  kind: "file" | "link";
  title: string;
  description: string | null;
  url: string | null;
  contentType: string | null;
  byteSize: number | null;
  filename: string | null;
  pinned: boolean;
  tags: string[];
  visibility: NoteVisibility;
  createdAt: string;
  createdByDisplayName?: string | null;
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  sharedMemberIds?: string[];
}

export interface DriveReference {
  id: string;
  driveObjectId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  object: DriveObject | null;
}

/** Lightweight attachment DTO from notes/notices list APIs */
export interface DriveAttachmentSummary {
  id: string;
  driveObjectId: string;
  title: string;
  kind: string;
  filename: string | null;
  url: string | null;
}

export function driveAttachmentToReference(att: DriveAttachmentSummary): DriveReference {
  return {
    id: att.id,
    driveObjectId: att.driveObjectId,
    entityType: "",
    entityId: "",
    createdAt: "",
    object: {
      id: att.driveObjectId,
      kind: att.kind as DriveObject["kind"],
      title: att.title,
      description: null,
      url: att.url,
      contentType: null,
      byteSize: null,
      filename: att.filename,
      pinned: false,
      tags: [],
      visibility: "household",
      createdAt: "",
    },
  };
}
