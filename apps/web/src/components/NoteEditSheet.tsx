"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteVisibility } from "../lib/note-visibility";
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
}: {
  note: Note | null;
  members: NoteShareMember[];
  currentMemberId?: string;
  tagSuggestions: string[];
  onTagQuery: (query: string) => void;
  onClose: () => void;
  onSaved: (note: Note) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("household");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
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
    setError(null);
  }, [note]);

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
          value={content}
          onChange={setContent}
          disabled={loading}
          aria-label="Note content"
          minRows={8}
        />
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={loading} disabled={!title.trim() || !content.trim()}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
