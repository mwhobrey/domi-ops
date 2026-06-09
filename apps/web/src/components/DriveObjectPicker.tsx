"use client";

import { FileText, FolderOpen, Link2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { DriveFolder, DriveObject } from "../lib/drive-types";
import { DrivePickerFolderNav } from "./DrivePickerFolderNav";
import { Alert, Button, Input, Sheet } from "./ui";

function sortObjects(list: DriveObject[]): DriveObject[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function DriveObjectPicker({
  open,
  onClose,
  onSelect,
  excludeIds = [],
  title = "Attach from Drive",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (object: DriveObject) => void;
  excludeIds?: string[];
  title?: string;
}) {
  const [objects, setObjects] = useState<DriveObject[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const skipFetch = useRef(true);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const searchActive = searchQuery.trim().length > 0;

  const fetchObjects = useCallback(
    async (
      q: string,
      tag: string | null,
      pinned: boolean,
      folderId: string | null,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (tag) params.set("tag", tag);
        if (pinned) params.set("pinned", "1");
        if (folderId && !q.trim() && !tag) params.set("folderId", folderId);
        const qs = params.toString();
        const data = await apiClient.get<{ objects: DriveObject[] }>(
          `/api/core/drive/objects${qs ? `?${qs}` : ""}`,
        );
        setObjects(sortObjects(data.objects));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load Drive items");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    skipFetch.current = true;
    setSearchQuery("");
    setActiveTag(null);
    setPinnedOnly(false);
    setCurrentFolderId(null);
    void fetchObjects("", null, false, null);
    void apiClient
      .get<{ folders: DriveFolder[] }>("/api/core/drive/folders")
      .then((data) => setFolders(data.folders))
      .catch(() => setFolders([]));
    void apiClient
      .get<{ suggestions: string[] }>("/api/core/drive/tags/suggestions")
      .then((data) => setTagSuggestions(data.suggestions))
      .catch(() => setTagSuggestions([]));
  }, [open, fetchObjects]);

  useEffect(() => {
    if (!open || skipFetch.current) {
      skipFetch.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void fetchObjects(searchQuery, activeTag, pinnedOnly, currentFolderId);
    }, 300);
    return () => clearTimeout(timer);
  }, [open, searchQuery, activeTag, pinnedOnly, currentFolderId, fetchObjects]);

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

  const selectable = objects.filter((o) => !excludeSet.has(o.id));

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-3 px-1 pb-2">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search title, description, or filename…"
          aria-label="Search Drive"
          disabled={loading}
        />
        {!searchActive && !activeTag && !pinnedOnly ? (
          <DrivePickerFolderNav
            folders={folders}
            currentFolderId={currentFolderId}
            onNavigate={setCurrentFolderId}
          />
        ) : searchActive ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Searching all folders. Clear search to browse by folder.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Drive picker filters">
          <Button
            type="button"
            size="sm"
            variant={pinnedOnly ? "primary" : "secondary"}
            aria-pressed={pinnedOnly}
            onClick={() => setPinnedOnly((v) => !v)}
          >
            Pinned only
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeTag === null ? "primary" : "secondary"}
            aria-pressed={activeTag === null}
            onClick={() => setActiveTag(null)}
          >
            All tags
          </Button>
          {filterTags.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="sm"
              variant={activeTag === tag ? "primary" : "secondary"}
              aria-pressed={activeTag === tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag}
            </Button>
          ))}
        </div>

        {loading && objects.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : selectable.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-[var(--color-text-muted)]">
            <FolderOpen className="h-8 w-8 opacity-50" aria-hidden />
            <p>No matching Drive items in this folder</p>
          </div>
        ) : (
          <ul
            className="max-h-[50vh] space-y-2 overflow-y-auto"
            aria-label="Drive items"
            aria-busy={loading}
          >
            {selectable.map((obj) => (
              <li key={obj.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition hover:border-[var(--color-accent)]/40"
                  onClick={() => {
                    onSelect(obj);
                    onClose();
                  }}
                >
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                    aria-hidden
                  >
                    {obj.kind === "link" ? (
                      <Link2 className="h-4 w-4" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[var(--color-text)]">{obj.title}</span>
                    {obj.filename ? (
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                        {obj.filename}
                      </span>
                    ) : null}
                    {obj.pinned ? (
                      <span className="mt-1 inline-block text-xs text-[var(--color-accent)]">
                        Pinned
                      </span>
                    ) : null}
                  </span>
                  <Search className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
