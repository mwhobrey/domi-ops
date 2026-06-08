"use client";

import { ExternalLink, FileText, FolderOpen, Link2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { NoteVisibilityBadge } from "./NoteVisibilityBadge";
import { DriveEditSheet } from "./DriveEditSheet";
import type { NoteShareMember } from "./NoteSharePicker";
import type { DriveObject } from "../lib/drive-types";
import {
  AnchorButton,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
} from "./ui";
import { ListPage } from "./lists/ListPage";

export type { DriveObject };

function sortObjects(list: DriveObject[]): DriveObject[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatByteSize(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DriveTagFilterBar({
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
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter Drive by tag">
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

type AddMode = "file" | "link";

export function DriveList({
  initialObjects,
  members = [],
  currentMemberId,
  canWrite = true,
}: {
  initialObjects: DriveObject[];
  members?: NoteShareMember[];
  currentMemberId?: string;
  canWrite?: boolean;
}) {
  const [objects, setObjects] = useState(() => sortObjects(initialObjects));
  const [addMode, setAddMode] = useState<AddMode>("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editObject, setEditObject] = useState<DriveObject | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const skipFilterFetch = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTagSuggestions = useCallback(async (query: string) => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/drive/tags/suggestions${params}`,
      );
      setTagSuggestions(data.suggestions);
    } catch {
      setTagSuggestions([]);
    }
  }, []);

  const fetchObjects = useCallback(async (q: string, tag: string | null) => {
    setFilterLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (tag) params.set("tag", tag);
      const qs = params.toString();
      const data = await apiClient.get<{ objects: DriveObject[] }>(
        `/api/core/drive/objects${qs ? `?${qs}` : ""}`,
      );
      setObjects(sortObjects(data.objects));
    } catch {
      setError("Could not load Drive items");
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
      void fetchObjects(searchQuery, activeTag);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeTag, fetchObjects]);

  const filterTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tag of tagSuggestions) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
    for (const obj of objects) {
      for (const tag of obj.tags ?? []) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [objects, tagSuggestions]);

  const hasActiveFilter = searchQuery.trim().length > 0 || activeTag !== null;

  async function uploadFile(selected: File): Promise<DriveObject> {
    const { uploadUrl, key, objectId } = await apiClient.post<{
      uploadUrl: string;
      key: string;
      objectId: string;
    }>("/api/core/drive/presign", {
      filename: selected.name,
      contentType: selected.type || "application/octet-stream",
      byteSize: selected.size,
    });
    const put = await fetch(uploadUrl, {
      method: "PUT",
      body: selected,
      headers: { "Content-Type": selected.type || "application/octet-stream" },
    });
    if (!put.ok) throw new Error("upload_failed");

    const displayTitle = title.trim() || selected.name;
    const data = await apiClient.post<{ object: DriveObject }>("/api/core/drive/objects", {
      id: objectId,
      kind: "file",
      title: displayTitle,
      description: description.trim() || null,
      s3Key: key,
      contentType: selected.type || "application/octet-stream",
      byteSize: selected.size,
      tags: parseTagsInput(tagsInput),
    });
    return data.object;
  }

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        canWrite ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Add Drive item type">
            <Button
              type="button"
              size="sm"
              variant={addMode === "file" ? "primary" : "secondary"}
              aria-pressed={addMode === "file"}
              onClick={() => setAddMode("file")}
            >
              Upload file
            </Button>
            <Button
              type="button"
              size="sm"
              variant={addMode === "link" ? "primary" : "secondary"}
              aria-pressed={addMode === "link"}
              onClick={() => setAddMode("link")}
            >
              Add link
            </Button>
          </div>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              setError(null);
              try {
                let created: DriveObject;
                if (addMode === "file") {
                  if (!file) {
                    setError("Choose a file to upload");
                    return;
                  }
                  created = await uploadFile(file);
                } else {
                  if (!title.trim() || !url.trim()) return;
                  const data = await apiClient.post<{ object: DriveObject }>(
                    "/api/core/drive/objects",
                    {
                      kind: "link",
                      title: title.trim(),
                      description: description.trim() || null,
                      url: url.trim(),
                      tags: parseTagsInput(tagsInput),
                    },
                  );
                  created = data.object;
                }
                if (!hasActiveFilter) {
                  setObjects((prev) => sortObjects([created, ...prev]));
                } else {
                  await fetchObjects(searchQuery, activeTag);
                }
                setTitle("");
                setDescription("");
                setUrl("");
                setTagsInput("");
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
                void fetchTagSuggestions("");
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Failed to add item");
              } finally {
                setLoading(false);
              }
            }}
          >
            <Input
              list="drive-tag-suggestions"
              placeholder="Tags (comma-separated)"
              value={tagsInput}
              onChange={(e) => {
                setTagsInput(e.target.value);
                void fetchTagSuggestions(e.target.value);
              }}
              aria-label="Tags"
              disabled={loading}
            />
            <datalist id="drive-tag-suggestions">
              {tagSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {addMode === "file" ? (
              <>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="File title"
                  placeholder="Title (optional — defaults to filename)"
                  disabled={loading}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="block w-full min-h-11 cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent-subtle)] file:px-3 file:py-2 file:text-sm"
                  aria-label="Choose file to upload"
                  disabled={loading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </>
            ) : (
              <>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Link title"
                  placeholder="Title"
                  disabled={loading}
                  required
                />
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-label="Link URL"
                  placeholder="https://…"
                  disabled={loading}
                  required
                />
              </>
            )}
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Description"
              placeholder="Description (optional)"
              disabled={loading}
            />
            <Button
              type="submit"
              loading={loading}
              disabled={addMode === "file" ? !file : !title.trim() || !url.trim()}
            >
              {addMode === "file" ? "Upload" : "Add link"}
            </Button>
          </form>
        </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            You have read-only access to Drive. Ask a household admin to change permissions in settings.
          </p>
        )
      }
    >
      <div className="mb-4 space-y-3">
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search title, description, or filename…"
          aria-label="Search Drive"
          disabled={filterLoading}
        />
        <DriveTagFilterBar tags={filterTags} activeTag={activeTag} onChange={setActiveTag} />
      </div>

      {objects.length === 0 ? (
        <EmptyState
          title={hasActiveFilter ? "No matching items" : "Drive is empty"}
          description={
            hasActiveFilter
              ? "Try another search or tag filter."
              : "Upload a file or add a link above."
          }
          icon={<FolderOpen className="h-10 w-10" />}
        />
      ) : (
        <ul className="space-y-3" aria-label="Drive items" aria-busy={filterLoading}>
          {objects.map((obj) => {
            const itemLabel = obj.title || obj.filename || "Drive item";
            const canManage =
              canWrite &&
              !obj.sharedWithMe &&
              (obj.visibility === "household" || Boolean(obj.isOwnedByMe));
            const sizeLabel = obj.kind === "file" ? formatByteSize(obj.byteSize) : null;
            const fileHref = `/api/core/drive/objects/${obj.id}/file`;

            return (
              <li key={obj.id}>
                <Card className="transition hover:border-[var(--color-accent)]/30">
                  <article className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                        aria-hidden
                      >
                        {obj.kind === "link" ? (
                          <Link2 className="h-5 w-5" />
                        ) : (
                          <FileText className="h-5 w-5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-[var(--color-text)]">
                          {obj.title}
                        </h3>
                        {obj.description ? (
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                            {obj.description}
                          </p>
                        ) : null}
                        {obj.kind === "file" && obj.filename ? (
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                            {obj.filename}
                            {sizeLabel ? ` · ${sizeLabel}` : ""}
                          </p>
                        ) : null}
                        {(obj.tags ?? []).length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1" role="list" aria-label="Tags">
                            {(obj.tags ?? []).map((tag) => (
                              <span key={tag} role="listitem">
                                <Badge tone="default">{tag}</Badge>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                          <NoteVisibilityBadge
                            visibility={obj.visibility ?? "household"}
                            sharedWithMe={obj.sharedWithMe}
                          />
                          <time dateTime={obj.createdAt}>
                            {new Date(obj.createdAt).toLocaleString()}
                          </time>
                          {obj.createdByDisplayName ? <span>{obj.createdByDisplayName}</span> : null}
                        </footer>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {obj.kind === "file" ? (
                        <AnchorButton
                          href={fileHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="secondary"
                          size="sm"
                          className="min-h-10"
                        >
                          Open / download
                        </AnchorButton>
                      ) : obj.url ? (
                        <AnchorButton
                          href={obj.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="secondary"
                          size="sm"
                          className="min-h-10"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden />
                          Open link
                        </AnchorButton>
                      ) : null}
                      {canManage ? (
                        <>
                          <Button
                            variant={obj.pinned ? "primary" : "secondary"}
                            size="sm"
                            className="min-h-10"
                            aria-pressed={obj.pinned}
                            aria-label={
                              obj.pinned ? `Unpin item: ${itemLabel}` : `Pin item: ${itemLabel}`
                            }
                            onClick={async () => {
                              const nextPinned = !obj.pinned;
                              setObjects((prev) =>
                                sortObjects(
                                  prev.map((item) =>
                                    item.id === obj.id ? { ...item, pinned: nextPinned } : item,
                                  ),
                                ),
                              );
                              try {
                                const data = await apiClient.patch<{ object: DriveObject }>(
                                  `/api/core/drive/objects/${obj.id}`,
                                  { pinned: nextPinned },
                                );
                                setObjects((prev) =>
                                  sortObjects(
                                    prev.map((item) =>
                                      item.id === obj.id ? data.object : item,
                                    ),
                                  ),
                                );
                              } catch {
                                setObjects((prev) =>
                                  sortObjects(
                                    prev.map((item) =>
                                      item.id === obj.id ? { ...item, pinned: obj.pinned } : item,
                                    ),
                                  ),
                                );
                                setError("Could not update pin");
                              }
                            }}
                          >
                            {obj.pinned ? "Pinned" : "Pin"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-10"
                            aria-label={`Edit item: ${itemLabel}`}
                            onClick={() => setEditObject(obj)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-10"
                            aria-label={`Delete item: ${itemLabel}`}
                            onClick={() => setDeleteId(obj.id)}
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

      <DriveEditSheet
        object={editObject}
        members={members}
        currentMemberId={currentMemberId}
        tagSuggestions={tagSuggestions}
        onTagQuery={(query) => void fetchTagSuggestions(query)}
        onClose={() => setEditObject(null)}
        onSaved={(updated) => {
          setObjects((prev) => sortObjects(prev.map((o) => (o.id === updated.id ? updated : o))));
          void fetchTagSuggestions("");
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Drive item?"
        message="This cannot be undone. Files are removed from storage."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          setObjects((prev) => prev.filter((x) => x.id !== id));
          await apiClient
            .delete(`/api/core/drive/objects/${id}`)
            .catch(() => setError("Delete failed"));
          void fetchTagSuggestions("");
        }}
        onCancel={() => setDeleteId(null)}
      />
    </ListPage>
  );
}
