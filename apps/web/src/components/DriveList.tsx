"use client";

import { ExternalLink, FileText, FolderOpen, Link2, Share2, Upload } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { NoteVisibilityBadge } from "./NoteVisibilityBadge";
import { DriveDropOverlay } from "./DriveDropOverlay";
import { DriveEditSheet } from "./DriveEditSheet";
import { DriveFolderBar } from "./DriveFolderBar";
import type { NoteShareMember } from "./NoteSharePicker";
import type { DriveFolder, DriveObject } from "../lib/drive-types";
import {
  currentFolderLabel,
  DRIVE_OBJECT_DRAG_TYPE,
  isExternalFileDrag,
} from "../lib/drive-folders-ui";
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

type FileUploadEntry = {
  id: string;
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
};

export function DriveList({
  initialObjects,
  initialFolders = [],
  members = [],
  currentMemberId,
  canWrite = true,
  publicSharesEnabled = true,
}: {
  initialObjects: DriveObject[];
  initialFolders?: DriveFolder[];
  members?: NoteShareMember[];
  currentMemberId?: string;
  canWrite?: boolean;
  publicSharesEnabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentFolderId = searchParams.get("folder");
  const highlightId = searchParams.get("highlight");

  const [folders, setFolders] = useState<DriveFolder[]>(initialFolders);
  const [objects, setObjects] = useState(() => sortObjects(initialObjects));
  const [addMode, setAddMode] = useState<AddMode>("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [hasSelectedFiles, setHasSelectedFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editObject, setEditObject] = useState<DriveObject | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [uploadQueue, setUploadQueue] = useState<FileUploadEntry[]>([]);
  const [pageDragActive, setPageDragActive] = useState(false);
  const [listDropActive, setListDropActive] = useState(false);
  const skipFilterFetch = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

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

  const fetchObjects = useCallback(
    async (q: string, tag: string | null, folderId: string | null) => {
      setFilterLoading(true);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (tag) params.set("tag", tag);
        if (folderId && !q.trim() && !tag) params.set("folderId", folderId);
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
    },
    [],
  );

  const navigateFolder = useCallback(
    (folderId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (folderId) params.set("folder", folderId);
      else params.delete("folder");
      params.delete("highlight");
      const qs = params.toString();
      router.push(qs ? `/drive?${qs}` : "/drive");
    },
    [router, searchParams],
  );

  useEffect(() => {
    void fetchTagSuggestions("");
  }, [fetchTagSuggestions]);

  useEffect(() => {
    skipFilterFetch.current = false;
    void fetchObjects(searchQuery, activeTag, currentFolderId);
  }, [currentFolderId]);

  useEffect(() => {
    if (skipFilterFetch.current) {
      skipFilterFetch.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void fetchObjects(searchQuery, activeTag, currentFolderId);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeTag, currentFolderId, fetchObjects]);

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

  const uploadFolderLabel = useMemo(
    () => currentFolderLabel(folders, currentFolderId),
    [folders, currentFolderId],
  );

  useEffect(() => {
    if (!canWrite) return;
    function onDragEnter(e: DragEvent) {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setPageDragActive(true);
    }
    function onDragLeave(e: DragEvent) {
      if (!isExternalFileDrag(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setPageDragActive(false);
    }
    function onDragOver(e: DragEvent) {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
    }
    function onDrop() {
      dragDepthRef.current = 0;
      setPageDragActive(false);
    }
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [canWrite]);

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
      folderId: currentFolderId,
    });
    return data.object;
  }

  const uploadFiles = useCallback(
    async (fileArray: File[]) => {
      if (fileArray.length === 0) return;
      setLoading(true);
      setError(null);
      const entries: FileUploadEntry[] = fileArray.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        status: "uploading",
      }));
      setUploadQueue(entries);

      const created: DriveObject[] = [];
      let hadError = false;

      for (let i = 0; i < fileArray.length; i++) {
        try {
          const obj = await uploadFile(fileArray[i]!);
          created.push(obj);
          setUploadQueue((prev) =>
            prev.map((entry, idx) => (idx === i ? { ...entry, status: "done" } : entry)),
          );
        } catch (err) {
          hadError = true;
          const message =
            err instanceof ApiError
              ? err.message === "quota_exceeded"
                ? "Storage quota full"
                : err.message
              : "Upload failed";
          setUploadQueue((prev) =>
            prev.map((entry, idx) =>
              idx === i ? { ...entry, status: "error", error: message } : entry,
            ),
          );
        }
      }

      if (!hasActiveFilter && created.length > 0) {
        setObjects((prev) => sortObjects([...created, ...prev]));
      } else if (created.length > 0) {
        await fetchObjects(searchQuery, activeTag, currentFolderId);
      }

      if (hadError && created.length === 0) {
        setError("Upload failed");
      } else if (hadError) {
        setError("Some files failed to upload");
      }

      setTitle("");
      setDescription("");
      setTagsInput("");
      setFile(null);
      setHasSelectedFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void fetchTagSuggestions("");
      setLoading(false);
      window.setTimeout(() => setUploadQueue([]), 4000);
    },
    [currentFolderId, description, fetchObjects, fetchTagSuggestions, hasActiveFilter, searchQuery, activeTag, tagsInput, title],
  );

  const moveObject = useCallback(
    async (objectId: string, targetFolderId: string | null) => {
      const existing = objects.find((o) => o.id === objectId);
      if (!existing) return;
      if ((existing.folderId ?? null) === targetFolderId) return;
      try {
        const data = await apiClient.patch<{ object: DriveObject }>(
          `/api/core/drive/objects/${objectId}`,
          { folderId: targetFolderId },
        );
        setObjects((prev) => {
          const inFolder =
            (data.object.folderId ?? null) === currentFolderId ||
            (data.object.folderId == null && currentFolderId == null);
          if (!inFolder) return prev.filter((o) => o.id !== objectId);
          return sortObjects(prev.map((o) => (o.id === objectId ? data.object : o)));
        });
        setError(null);
      } catch {
        setError("Could not move item");
      }
    },
    [objects, currentFolderId],
  );

  function handleListFileDrop(e: React.DragEvent) {
    if (!canWrite || !isExternalFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setPageDragActive(false);
    setListDropActive(false);
    const dropped = [...e.dataTransfer.files];
    if (dropped.length > 0) void uploadFiles(dropped);
  }

  return (
    <>
      <DriveDropOverlay visible={pageDragActive && canWrite} folderLabel={uploadFolderLabel} />
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
          {addMode === "file" ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Uploading to:{" "}
              <span className="font-medium text-[var(--color-text)]">{uploadFolderLabel}</span>
            </p>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">
              Adding link to:{" "}
              <span className="font-medium text-[var(--color-text)]">{uploadFolderLabel}</span>
            </p>
          )}
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                if (addMode === "file") {
                  const picked = fileInputRef.current?.files;
                  if (!picked?.length && !file) {
                    setError("Choose a file to upload");
                    return;
                  }
                  const files = picked?.length ? [...picked] : file ? [file] : [];
                  if (files.length > 1) {
                    await uploadFiles(files);
                    return;
                  }
                  setLoading(true);
                  const created = await uploadFile(files[0]!);
                  if (!hasActiveFilter) {
                    setObjects((prev) => sortObjects([created, ...prev]));
                  } else {
                    await fetchObjects(searchQuery, activeTag, currentFolderId);
                  }
                  setTitle("");
                  setDescription("");
                  setTagsInput("");
                  setFile(null);
                  setHasSelectedFiles(false);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  void fetchTagSuggestions("");
                } else {
                  if (!title.trim() || !url.trim()) return;
                  setLoading(true);
                  const data = await apiClient.post<{ object: DriveObject }>(
                    "/api/core/drive/objects",
                    {
                      kind: "link",
                      title: title.trim(),
                      description: description.trim() || null,
                      url: url.trim(),
                      tags: parseTagsInput(tagsInput),
                      folderId: currentFolderId,
                    },
                  );
                  const created = data.object;
                  if (!hasActiveFilter) {
                    setObjects((prev) => sortObjects([created, ...prev]));
                  } else {
                    await fetchObjects(searchQuery, activeTag, currentFolderId);
                  }
                  setTitle("");
                  setDescription("");
                  setUrl("");
                  setTagsInput("");
                  void fetchTagSuggestions("");
                }
              } catch (err) {
                const message =
                  err instanceof ApiError
                    ? err.message === "quota_exceeded"
                      ? "Storage quota full — free space or ask an admin"
                      : err.message
                    : "Failed to add item";
                setError(message);
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
                <div
                  className={`rounded-lg border border-dashed p-3 transition ${
                    listDropActive
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                      : "border-[var(--color-border)]"
                  }`}
                  onDragOver={(e) => {
                    if (!canWrite || !isExternalFileDrag(e)) return;
                    e.preventDefault();
                    setListDropActive(true);
                  }}
                  onDragLeave={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && e.currentTarget.contains(next)) return;
                    setListDropActive(false);
                  }}
                  onDrop={handleListFileDrop}
                >
                  <p className="mb-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <Upload className="h-4 w-4 shrink-0" aria-hidden />
                    Drag files here or choose below
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="block w-full min-h-11 cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent-subtle)] file:px-3 file:py-2 file:text-sm"
                    aria-label="Choose files to upload"
                    disabled={loading}
                    onChange={(e) => {
                      const picked = e.target.files;
                      setHasSelectedFiles(Boolean(picked?.length));
                      setFile(picked?.[0] ?? null);
                    }}
                  />
                </div>
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
              disabled={addMode === "file" ? !file && !hasSelectedFiles : !title.trim() || !url.trim()}
            >
              {addMode === "file" ? "Upload" : "Add link"}
            </Button>
            {uploadQueue.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="Upload progress" aria-live="polite">
                {uploadQueue.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      entry.status === "error"
                        ? "text-[var(--color-danger)]"
                        : "text-[var(--color-text-muted)]"
                    }
                  >
                    {entry.name}
                    {entry.status === "uploading"
                      ? " — Uploading…"
                      : entry.status === "done"
                        ? " — Done"
                        : entry.error
                          ? ` — ${entry.error}`
                          : " — Failed"}
                  </li>
                ))}
              </ul>
            ) : null}
          </form>
        </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            You have read-only access to Drive. Ask a household admin to change permissions in settings.
          </p>
        )
      }
    >
      <DriveFolderBar
        folders={folders}
        currentFolderId={currentFolderId}
        canWrite={canWrite}
        onFoldersChange={setFolders}
        onNavigate={navigateFolder}
        onMoveObject={canWrite ? moveObject : undefined}
      />

      <div
        className={`space-y-4 rounded-[var(--radius-lg)] transition ${
          listDropActive && canWrite
            ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]"
            : ""
        }`}
        onDragOver={(e) => {
          if (!canWrite || !isExternalFileDrag(e)) return;
          e.preventDefault();
          setListDropActive(true);
        }}
        onDragLeave={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          setListDropActive(false);
        }}
        onDrop={handleListFileDrop}
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
              : canWrite
                ? "Upload a file, drag files here, or add a link above."
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
              <li
                key={obj.id}
                draggable={canManage}
                onDragStart={(e) => {
                  if (!canManage) return;
                  e.dataTransfer.setData(DRIVE_OBJECT_DRAG_TYPE, obj.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className={canManage ? "cursor-grab active:cursor-grabbing" : undefined}
                aria-grabbed={canManage ? false : undefined}
              >
                <Card
                  className={`transition hover:border-[var(--color-accent)]/30 ${
                    highlightId === obj.id ? "ring-2 ring-[var(--color-accent)]" : ""
                  }`}
                >
                  <article className="p-4 sm:p-5" aria-label={canManage ? `${itemLabel}. Drag to a folder to move.` : itemLabel}>
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
                          {obj.kind === "file" && publicSharesEnabled ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-10"
                              aria-label={`Create share link for ${itemLabel}`}
                              onClick={async () => {
                                try {
                                  const data = await apiClient.post<{
                                    token: { shareUrl: string };
                                  }>(`/api/core/drive/objects/${obj.id}/share-tokens`, {});
                                  await navigator.clipboard.writeText(data.token.shareUrl);
                                  setError(null);
                                } catch {
                                  setError("Could not create share link");
                                }
                              }}
                            >
                              <Share2 className="h-4 w-4" aria-hidden />
                              Share
                            </Button>
                          ) : null}
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
      </div>

      <DriveEditSheet
        object={editObject}
        folders={folders}
        members={members}
        currentMemberId={currentMemberId}
        tagSuggestions={tagSuggestions}
        onTagQuery={(query) => void fetchTagSuggestions(query)}
        onClose={() => setEditObject(null)}
        onSaved={(updated) => {
          setObjects((prev) => {
            const inFolder =
              (updated.folderId ?? null) === currentFolderId ||
              (updated.folderId == null && currentFolderId == null);
            if (!inFolder) return prev.filter((o) => o.id !== updated.id);
            return sortObjects(prev.map((o) => (o.id === updated.id ? updated : o)));
          });
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
    </>
  );
}
