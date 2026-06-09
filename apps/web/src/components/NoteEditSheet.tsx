"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteVisibility } from "../lib/note-visibility";
import { insertDriveEmbed, parseDriveEmbedIds } from "../lib/drive-embeds";
import type { DriveEmbedObject, DriveReference } from "../lib/drive-types";
import { driveAttachmentToReference } from "../lib/drive-types";
import { DriveAttachmentChips } from "./DriveAttachmentChips";
import { DriveObjectPicker } from "./DriveObjectPicker";
import { NoteSharePicker, type NoteShareMember } from "./NoteSharePicker";
import { NoteVisibilityPicker } from "./NoteVisibilityPicker";
import { Alert, Button, Input, MarkdownEditor, Sheet } from "./ui";

export interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  tags: string[];
  visibility: NoteVisibility;
  createdAt: string;
  createdByDisplayName?: string | null;
  createdByUserId?: string | null;
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  sharedMemberIds?: string[];
  driveAttachments?: {
    id: string;
    driveObjectId: string;
    title: string;
    kind: string;
    filename: string | null;
    url: string | null;
  }[];
  driveEmbeds?: Record<string, DriveEmbedObject>;
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function NoteEditSheet({
  note,
  members,
  currentMemberId,
  tagSuggestions,
  onTagQuery,
  onClose,
  onSaved,
  driveEnabled = false,
}: {
  note: Note | null;
  members: NoteShareMember[];
  currentMemberId?: string;
  tagSuggestions: string[];
  onTagQuery: (query: string) => void;
  onClose: () => void;
  onSaved: (note: Note) => void;
  driveEnabled?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("household");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<DriveReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [embedPickerOpen, setEmbedPickerOpen] = useState(false);
  const [previewEmbeds, setPreviewEmbeds] = useState<Record<string, DriveEmbedObject> | null>(
    null,
  );
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    setTitle(note.title);
    setContent(note.content);
    setPinned(note.pinned);
    setTagsInput((note.tags ?? []).join(", "));
    setVisibility(note.visibility ?? "household");
    setSharedMemberIds(note.sharedMemberIds ?? []);
    setAttachments((note.driveAttachments ?? []).map(driveAttachmentToReference));
    setError(null);
  }, [note]);

  const embedIds = useMemo(
    () => (driveEnabled ? parseDriveEmbedIds(content) : []),
    [content, driveEnabled],
  );

  const mergedPreviewEmbeds = useMemo(() => {
    if (!driveEnabled) return undefined;
    const fromNote = note?.driveEmbeds ?? {};
    const fromResolve = previewEmbeds ?? {};
    if (Object.keys(fromNote).length === 0 && Object.keys(fromResolve).length === 0) {
      return undefined;
    }
    return { ...fromNote, ...fromResolve };
  }, [driveEnabled, note?.driveEmbeds, previewEmbeds]);

  useEffect(() => {
    if (!driveEnabled || embedIds.length === 0) {
      setPreviewEmbeds(null);
      return;
    }
    const timer = setTimeout(() => {
      void apiClient
        .get<{ objects: Record<string, DriveEmbedObject> }>(
          `/api/core/drive/objects/resolve?ids=${encodeURIComponent(embedIds.join(","))}`,
        )
        .then((data) => setPreviewEmbeds(data.objects))
        .catch(() => setPreviewEmbeds({}));
    }, 300);
    return () => clearTimeout(timer);
  }, [driveEnabled, embedIds]);

  useEffect(() => {
    if (!note || !driveEnabled) return;
    void apiClient
      .get<{ references: DriveReference[] }>(
        `/api/core/drive/references?entityType=note&entityId=${note.id}`,
      )
      .then((data) => setAttachments(data.references))
      .catch(() => {
        /* keep list attachments from note prop */
      });
  }, [note, driveEnabled]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!note || !title.trim() || !content.trim()) return;
    setLoading(true);
    setError(null);
    const tags = parseTagsInput(tagsInput);
    try {
      const data = await apiClient.patch<{ note?: Note }>(`/api/core/notes/${note.id}`, {
        title: title.trim(),
        content: content.trim(),
        pinned,
        tags,
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : [],
      });
      onSaved(
        data.note ?? {
          ...note,
          title: title.trim(),
          content: content.trim(),
          pinned,
          tags,
          visibility,
          sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
        },
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={note !== null}
      onClose={onClose}
      title="Edit note"
      description="Update title, content, pin status, tags, and who can see it."
    >
      <form className="space-y-4 px-6 pb-6" onSubmit={(e) => void save(e)}>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <NoteVisibilityPicker
          name="edit-note-visibility"
          value={visibility}
          onChange={(next) => {
            setVisibility(next);
            if (next === "household") setSharedMemberIds([]);
          }}
          disabled={loading}
        />
        {visibility === "private" ? (
          <NoteSharePicker
            namePrefix="edit-note"
            members={members}
            currentMemberId={currentMemberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            disabled={loading}
          />
        ) : null}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Note title"
          placeholder="Title"
          disabled={loading}
          required
        />
        <Button
          type="button"
          variant={pinned ? "primary" : "secondary"}
          size="sm"
          aria-pressed={pinned}
          aria-label={pinned ? "Unpin note" : "Pin note to top"}
          disabled={loading}
          onClick={() => setPinned((prev) => !prev)}
        >
          {pinned ? "Pinned" : "Pin to top"}
        </Button>
        <Input
          list="note-edit-tag-suggestions"
          value={tagsInput}
          onChange={(e) => {
            setTagsInput(e.target.value);
            onTagQuery(e.target.value);
          }}
          aria-label="Tags"
          placeholder="Tags (comma-separated)"
          disabled={loading}
        />
        <datalist id="note-edit-tag-suggestions">
          {tagSuggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <MarkdownEditor
          key={note?.id}
          value={content}
          onChange={setContent}
          disabled={loading}
          aria-label="Note content"
          minRows={8}
          driveEmbeds={mergedPreviewEmbeds}
          driveEmbedAutocomplete={driveEnabled && !note?.sharedWithMe}
        />
        {driveEnabled && note && !note.sharedWithMe ? (
          <div className="space-y-2">
            <p className="text-xs text-[var(--color-text-muted)]">
              Type <code className="font-mono">[[</code> in the editor to link a Drive file, drag a
              chip above into the body for an inline embed, or use manual syntax{" "}
              <code className="font-mono">[[drive:uuid|label]]</code>.
            </p>
            <p className="text-sm font-medium">Drive attachments</p>
            <DriveAttachmentChips
              references={attachments}
              removingId={removingId}
              draggable
              onRemove={async (referenceId) => {
                setRemovingId(referenceId);
                try {
                  await apiClient.delete(`/api/core/drive/references/${referenceId}`);
                  setAttachments((prev) => prev.filter((r) => r.id !== referenceId));
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not remove attachment");
                } finally {
                  setRemovingId(null);
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loading}
                onClick={() => setPickerOpen(true)}
              >
                Attach from Drive
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loading}
                onClick={() => setEmbedPickerOpen(true)}
              >
                Insert embed
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={loading} disabled={!title.trim() || !content.trim()}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      {driveEnabled ? (
        <>
        <DriveObjectPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          excludeIds={attachments.map((a) => a.driveObjectId)}
          onSelect={async (object) => {
            if (!note) return;
            try {
              const data = await apiClient.post<{ reference: { id: string } }>(
                "/api/core/drive/references",
                {
                  driveObjectId: object.id,
                  entityType: "note",
                  entityId: note.id,
                },
              );
              setAttachments((prev) => [
                ...prev,
                {
                  id: data.reference.id,
                  driveObjectId: object.id,
                  entityType: "note",
                  entityId: note.id,
                  createdAt: new Date().toISOString(),
                  object,
                },
              ]);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not attach file");
            }
          }}
        />
        <DriveObjectPicker
          open={embedPickerOpen}
          onClose={() => setEmbedPickerOpen(false)}
          onSelect={(object) => {
            setContent((prev) =>
              insertDriveEmbed(prev, object.id, object.filename ?? object.title),
            );
            setEmbedPickerOpen(false);
          }}
        />
        </>
      ) : null}
    </Sheet>
  );
}
