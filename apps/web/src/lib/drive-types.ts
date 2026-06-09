import type { NoteVisibility } from "./note-visibility";

export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt?: string;
}

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
  folderId?: string | null;
  createdAt: string;
  createdByDisplayName?: string | null;
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  sharedMemberIds?: string[];
}

export interface DriveShareToken {
  id: string;
  token: string;
  expiresAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  objectId?: string;
  objectTitle?: string;
  shareUrl: string;
}

export interface DriveStorageInfo {
  usedBytes: number;
  quotaBytes: number | null;
}

export interface DriveReference {
  id: string;
  driveObjectId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  object: DriveObject | null;
}

/** Resolved Drive object for inline `[[drive:uuid|label]]` embeds in note markdown */
export interface DriveEmbedObject {
  id: string;
  title: string;
  kind: string;
  filename: string | null;
  url: string | null;
  contentType?: string | null;
}

export function driveEmbedToObject(embed: DriveEmbedObject): DriveObject {
  return {
    id: embed.id,
    kind: embed.kind as DriveObject["kind"],
    title: embed.title,
    description: null,
    url: embed.url,
    contentType: embed.contentType ?? null,
    byteSize: null,
    filename: embed.filename,
    pinned: false,
    tags: [],
    visibility: "household",
    createdAt: "",
  };
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
