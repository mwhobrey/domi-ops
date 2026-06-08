"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { DriveObject } from "../lib/drive-types";
import type { NoteVisibility } from "../lib/note-visibility";
import { NoteSharePicker, type NoteShareMember } from "./NoteSharePicker";
import { NoteVisibilityPicker } from "./NoteVisibilityPicker";
import { Alert, Button, Input, Sheet } from "./ui";

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function DriveEditSheet({
  object,
  members,
  currentMemberId,
  tagSuggestions,
  onTagQuery,
  onClose,
  onSaved,
}: {
  object: DriveObject | null;
  members: NoteShareMember[];
  currentMemberId?: string;
  tagSuggestions: string[];
  onTagQuery: (query: string) => void;
  onClose: () => void;
  onSaved: (object: DriveObject) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [pinned, setPinned] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("household");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!object) return;
    setTitle(object.title);
    setDescription(object.description ?? "");
    setUrl(object.url ?? "");
    setPinned(object.pinned);
    setTagsInput((object.tags ?? []).join(", "));
    setVisibility(object.visibility ?? "household");
    setSharedMemberIds(object.sharedMemberIds ?? []);
    setError(null);
  }, [object]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!object || !title.trim()) return;
    setLoading(true);
    setError(null);
    const tags = parseTagsInput(tagsInput);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        pinned,
        tags,
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : [],
      };
      if (object.kind === "link") {
        body.url = url.trim();
      }
      const data = await apiClient.patch<{ object: DriveObject }>(
        `/api/core/drive/objects/${object.id}`,
        body,
      );
      onSaved(data.object);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={object !== null} onClose={onClose} title="Edit Drive item">
      {object ? (
        <form className="space-y-3" onSubmit={save}>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <NoteVisibilityPicker
            name="drive-edit-visibility"
            value={visibility}
            onChange={(next) => {
              setVisibility(next);
              if (next === "household") setSharedMemberIds([]);
            }}
            disabled={loading || Boolean(object.sharedWithMe)}
          />
          {visibility === "private" && !object.sharedWithMe ? (
            <NoteSharePicker
              namePrefix="drive-edit"
              members={members}
              currentMemberId={currentMemberId}
              value={sharedMemberIds}
              onChange={setSharedMemberIds}
              disabled={loading}
            />
          ) : null}
          <Input
            list="drive-edit-tag-suggestions"
            placeholder="Tags (comma-separated)"
            value={tagsInput}
            onChange={(e) => {
              setTagsInput(e.target.value);
              onTagQuery(e.target.value);
            }}
            aria-label="Tags"
            disabled={loading}
          />
          <datalist id="drive-edit-tag-suggestions">
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Title"
            placeholder="Title"
            disabled={loading}
            required
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description"
            placeholder="Description (optional)"
            disabled={loading}
          />
          {object.kind === "link" ? (
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Link URL"
              placeholder="https://…"
              disabled={loading}
              required
            />
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              disabled={loading}
            />
            Pin to top
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={loading} disabled={!title.trim()}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}
