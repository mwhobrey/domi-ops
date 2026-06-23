"use client";

import { NotebookPen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markdownExcerpt } from "../lib/markdown";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteVisibility } from "../lib/note-visibility";
import { driveAttachmentToReference } from "../lib/drive-types";
import { DriveAttachmentChips } from "./DriveAttachmentChips";
import { NoteEditSheet, type Note } from "./NoteEditSheet";
import { NoteSharePicker, type NoteShareMember } from "./NoteSharePicker";
import { NoteVisibilityBadge } from "./NoteVisibilityBadge";
import { NoteVisibilityPicker } from "./NoteVisibilityPicker";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  MarkdownContent,
  MarkdownEditor,
} from "./ui";
import { ListPage } from "./lists/ListPage";
import { CollapsibleAddForm } from "./lists/CollapsibleAddForm";

const PREVIEW_LENGTH = 120;

function sortNotes(list: Note[]): Note[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function noteNeedsExpand(content: string): boolean {
  return markdownExcerpt(content, PREVIEW_LENGTH + 1).length > PREVIEW_LENGTH;
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function NoteTagFilterBar({
  tags,
  activeTag,
  onChange,
}: {
  tags: string[];
  activeTag: string | null;
  onChange: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Filter notes by tag"
    >
      <Button
        type="button"
        size="sm"
        variant={activeTag === null ? "primary" : "secondary"}
        aria-pressed={activeTag === null}
        onClick={() => onChange(null)}
      >
        All tags
      </Button>
      {tags.map((tag) => (
        <Button
          key={tag}
          type="button"
          size="sm"
          variant={activeTag === tag ? "primary" : "secondary"}
          aria-pressed={activeTag === tag}
          onClick={() => onChange(activeTag === tag ? null : tag)}
        >
          {tag}
        </Button>
      ))}
    </div>
  );
}

export function NotesList({
  initialNotes,
  members = [],
  currentMemberId,
  driveEnabled = false,
}: {
  initialNotes: Note[];
  members?: NoteShareMember[];
  currentMemberId?: string;
  driveEnabled?: boolean;
}) {
  const [notes, setNotes] = useState(() => sortNotes(initialNotes));
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("household");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const skipFilterFetch = useRef(true);

  const fetchTagSuggestions = useCallback(async (query: string) => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/notes/tag-suggestions${params}`,
      );
      setTagSuggestions(data.suggestions);
    } catch {
      setTagSuggestions([]);
    }
  }, []);

  const fetchNotes = useCallback(async (q: string, tag: string | null) => {
    setFilterLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (tag) params.set("tag", tag);
      const qs = params.toString();
      const data = await apiClient.get<{ notes: Note[] }>(
        `/api/core/notes${qs ? `?${qs}` : ""}`,
      );
      setNotes(sortNotes(data.notes));
    } catch {
      setError("Could not load notes");
    } finally {
      setFilterLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTagSuggestions("");
  }, [fetchTagSuggestions]);

  useEffect(() => {
    if (skipFilterFetch.current) {
      skipFilterFetch.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void fetchNotes(searchQuery, activeTag);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeTag, fetchNotes]);

  const filterTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tag of tagSuggestions) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
    for (const note of notes) {
      for (const tag of note.tags ?? []) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [notes, tagSuggestions]);

  const hasActiveFilter = searchQuery.trim().length > 0 || activeTag !== null;

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        <CollapsibleAddForm label="Add note">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || !content.trim()) return;
            setLoading(true);
            try {
              const data = await apiClient.post<{ note: Note }>("/api/core/notes", {
                title: title.trim(),
                content: content.trim(),
                tags: parseTagsInput(tagsInput),
                visibility,
                sharedMemberIds: visibility === "private" ? sharedMemberIds : [],
              });
              if (!hasActiveFilter) {
                setNotes((prev) => sortNotes([data.note, ...prev]));
              } else {
                await fetchNotes(searchQuery, activeTag);
              }
              setTitle("");
              setContent("");
              setTagsInput("");
              setVisibility("household");
              setSharedMemberIds([]);
              void fetchTagSuggestions("");
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Failed");
            } finally {
              setLoading(false);
            }
          }}
        >
          <NoteVisibilityPicker
            name="new-note-visibility"
            value={visibility}
            onChange={(next) => {
              setVisibility(next);
              if (next === "household") setSharedMemberIds([]);
            }}
            disabled={loading}
          />
          {visibility === "private" ? (
            <NoteSharePicker
              namePrefix="new-note"
              members={members}
              currentMemberId={currentMemberId}
              value={sharedMemberIds}
              onChange={setSharedMemberIds}
              disabled={loading}
            />
          ) : null}
          <Input
            list="note-tag-suggestions"
            placeholder="Tags (comma-separated)"
            value={tagsInput}
            onChange={(e) => {
              setTagsInput(e.target.value);
              void fetchTagSuggestions(e.target.value);
            }}
            aria-label="Tags"
            disabled={loading}
          />
          <datalist id="note-tag-suggestions">
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Note title"
            placeholder="Title"
            disabled={loading}
            required
          />
          <MarkdownEditor
            value={content}
            onChange={setContent}
            disabled={loading}
            aria-label="New note"
            placeholder="Note content…"
            driveEmbedAutocomplete={driveEnabled}
          />
          <Button type="submit" loading={loading} disabled={!title.trim() || !content.trim()}>
            Add note
          </Button>
        </form>
        </CollapsibleAddForm>
      }
    >
      <div className="mb-4 space-y-3">
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search title or content…"
          aria-label="Search notes"
          disabled={filterLoading}
        />
        <NoteTagFilterBar tags={filterTags} activeTag={activeTag} onChange={setActiveTag} />
      </div>

      {notes.length === 0 ? (
        <EmptyState
          title={hasActiveFilter ? "No matching notes" : "No notes"}
          description={
            hasActiveFilter ? "Try another search or tag filter." : "Jot something down above."
          }
          icon={<NotebookPen className="h-10 w-10" />}
        />
      ) : (
        <ul className="space-y-3" aria-label="Notes" aria-busy={filterLoading}>
          {notes.map((n) => {
            const open = expanded === n.id;
            const expandable = noteNeedsExpand(n.content);
            const preview = markdownExcerpt(n.content, PREVIEW_LENGTH);
            const noteLabel = n.title || preview.slice(0, 40) || "Note";
            const canManage =
              !n.sharedWithMe && (n.visibility === "household" || Boolean(n.isOwnedByMe));

            return (
              <li key={n.id}>
                <Card className="transition hover:border-[var(--color-accent)]/30">
                  <article className="p-4">
                    <h3 className="text-base font-semibold text-[var(--color-text)]">{n.title}</h3>
                    {open || !expandable ? (
                      <div className="mt-2">
                        <MarkdownContent
                          source={n.content}
                          driveEmbeds={n.driveEmbeds}
                        />
                      </div>
                    ) : preview ? (
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{preview}</p>
                    ) : null}
                    {(n.tags ?? []).length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1" role="list" aria-label="Tags">
                        {(n.tags ?? []).map((tag) => (
                          <span key={tag} role="listitem">
                            <Badge tone="default">{tag}</Badge>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {driveEnabled && (n.driveAttachments ?? []).length > 0 ? (
                      <div className="mt-3">
                        <DriveAttachmentChips
                          references={(n.driveAttachments ?? []).map(driveAttachmentToReference)}
                        />
                      </div>
                    ) : null}
                    <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      <NoteVisibilityBadge
                        visibility={n.visibility ?? "household"}
                        sharedWithMe={n.sharedWithMe}
                        sharedCount={n.sharedMemberIds?.length ?? 0}
                      />
                      <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString()}</time>
                      {n.createdByDisplayName ? <span>{n.createdByDisplayName}</span> : null}
                    </footer>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {expandable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : n.id)}
                        >
                          {open ? "Collapse" : "Expand"}
                        </Button>
                      )}
                      {canManage ? (
                        <>
                          <Button
                            variant={n.pinned ? "primary" : "secondary"}
                            size="sm"
                            aria-pressed={n.pinned}
                            aria-label={n.pinned ? `Unpin note: ${noteLabel}` : `Pin note: ${noteLabel}`}
                            onClick={async () => {
                              const nextPinned = !n.pinned;
                              setNotes((prev) =>
                                sortNotes(
                                  prev.map((item) =>
                                    item.id === n.id ? { ...item, pinned: nextPinned } : item,
                                  ),
                                ),
                              );
                              try {
                                const data = await apiClient.patch<{ note: Note }>(
                                  `/api/core/notes/${n.id}`,
                                  { pinned: nextPinned },
                                );
                                setNotes((prev) =>
                                  sortNotes(
                                    prev.map((item) =>
                                      item.id === n.id ? data.note : item,
                                    ),
                                  ),
                                );
                              } catch {
                                setNotes((prev) =>
                                  sortNotes(
                                    prev.map((item) =>
                                      item.id === n.id ? { ...item, pinned: n.pinned } : item,
                                    ),
                                  ),
                                );
                                setError("Could not update pin");
                              }
                            }}
                          >
                            {n.pinned ? "Pinned" : "Pin"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit note: ${noteLabel}`}
                            onClick={() => setEditNote(n)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete note: ${noteLabel}`}
                            onClick={() => setDeleteId(n.id)}
                          >
                            Delete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <NoteEditSheet
        note={editNote}
        members={members}
        currentMemberId={currentMemberId}
        driveEnabled={driveEnabled}
        tagSuggestions={tagSuggestions}
        onTagQuery={(query) => void fetchTagSuggestions(query)}
        onClose={() => setEditNote(null)}
        onSaved={(updated) => {
          setNotes((prev) => sortNotes(prev.map((n) => (n.id === updated.id ? updated : n))));
          void fetchTagSuggestions("");
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete note?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          setNotes((prev) => prev.filter((x) => x.id !== id));
          await apiClient.delete(`/api/core/notes/${id}`).catch(() => setError("Delete failed"));
          void fetchTagSuggestions("");
        }}
        onCancel={() => setDeleteId(null)}
      />
    </ListPage>
  );
}
