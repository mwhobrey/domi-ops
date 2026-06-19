"use client";

import { ArrowLeft, Folder, FolderPlus, FolderUp, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { DriveFolder } from "../lib/drive-types";
import {
  buildFolderBreadcrumbItems,
  childFoldersForParent,
  DRIVE_OBJECT_DRAG_TYPE,
  isExternalFileDrag,
  parentFolderId,
  parentFolderLabel,
} from "../lib/drive-folders-ui";
import { Breadcrumb } from "./ui/Breadcrumb";
import { Button, ConfirmDialog, Input } from "./ui";

export function DriveFolderBar({
  folders,
  currentFolderId,
  canWrite,
  onFoldersChange,
  onNavigate,
  onMoveObject,
}: {
  folders: DriveFolder[];
  currentFolderId: string | null;
  canWrite: boolean;
  onFoldersChange: (folders: DriveFolder[]) => void;
  onNavigate: (folderId: string | null) => void;
  onMoveObject?: (objectId: string, targetFolderId: string | null) => void | Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameFolder, setRenameFolder] = useState<DriveFolder | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteFolder, setDeleteFolder] = useState<DriveFolder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | "root" | null>(null);

  function handleObjectDragOver(
    e: React.DragEvent,
    targetFolderId: string | "root",
  ) {
    if (!onMoveObject || isExternalFileDrag(e)) return;
    if (!e.dataTransfer.types.includes(DRIVE_OBJECT_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetFolderId(targetFolderId);
  }

  function handleObjectDragLeave(e: React.DragEvent, targetFolderId: string | "root") {
    if (dropTargetFolderId !== targetFolderId) return;
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setDropTargetFolderId(null);
  }

  async function handleObjectDrop(
    e: React.DragEvent,
    targetFolderId: string | null,
  ) {
    setDropTargetFolderId(null);
    if (!onMoveObject || isExternalFileDrag(e)) return;
    e.preventDefault();
    const objectId = e.dataTransfer.getData(DRIVE_OBJECT_DRAG_TYPE);
    if (!objectId) return;
    await onMoveObject(objectId, targetFolderId);
  }

  const childFolders = useMemo(
    () => childFoldersForParent(folders, currentFolderId),
    [folders, currentFolderId],
  );

  const upFolderId = useMemo(
    () => parentFolderId(folders, currentFolderId),
    [folders, currentFolderId],
  );

  const upFolderName = useMemo(
    () => parentFolderLabel(folders, currentFolderId),
    [folders, currentFolderId],
  );

  const currentFolder = useMemo(
    () => (currentFolderId ? folders.find((f) => f.id === currentFolderId) : null),
    [folders, currentFolderId],
  );

  const breadcrumbItems = useMemo(() => {
    const items = buildFolderBreadcrumbItems(folders, currentFolderId);
    return items.map((item, i) => ({
      label: item.label,
      href:
        i === 0
          ? "/drive"
          : item.folderId
            ? `/drive?folder=${item.folderId}`
            : "/drive",
    }));
  }, [folders, currentFolderId]);

  async function refreshFolders() {
    const data = await apiClient.get<{ folders: DriveFolder[] }>("/api/core/drive/folders");
    onFoldersChange(data.folders);
  }

  const rootDropActive = dropTargetFolderId === "root";

  return (
    <div className="space-y-3">
      {currentFolderId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => onNavigate(upFolderId)}
              aria-label={`Back to ${upFolderName}`}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to {upFolderName}
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <Folder className="h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden />
              <span className="truncate text-base font-semibold text-[var(--color-text)]">
                {currentFolder?.name ?? "Folder"}
              </span>
            </div>
          </div>
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Create folder"
              onClick={() => {
                setNewName("");
                setCreateOpen(true);
                setError(null);
              }}
            >
              <FolderPlus className="h-4 w-4" aria-hidden />
              New folder
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={`rounded-[var(--radius-md)] transition ${
            rootDropActive
              ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]"
              : ""
          }`}
          onDragOver={(e) => handleObjectDragOver(e, "root")}
          onDragLeave={(e) => handleObjectDragLeave(e, "root")}
          onDrop={(e) => void handleObjectDrop(e, null)}
        >
          <Breadcrumb
            className={currentFolderId ? "mb-0" : undefined}
            items={breadcrumbItems.map((item, i) => ({
              ...item,
              href:
                i < breadcrumbItems.length - 1
                  ? item.href
                  : undefined,
            }))}
          />
        </div>
        {!currentFolderId && canWrite ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="Create folder"
            onClick={() => {
              setNewName("");
              setCreateOpen(true);
              setError(null);
            }}
          >
            <FolderPlus className="h-4 w-4" aria-hidden />
            New folder
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      ) : null}

      {currentFolderId || childFolders.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Folders">
          {currentFolderId ? (
            <li>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)]"
                onClick={() => onNavigate(upFolderId)}
                aria-label={`Up to ${upFolderName}`}
              >
                <FolderUp className="h-5 w-5 shrink-0" aria-hidden />
                <span className="truncate font-medium">{upFolderName}</span>
              </button>
            </li>
          ) : null}
          {childFolders.map((folder) => {
            const folderDropActive = dropTargetFolderId === folder.id;
            return (
            <li key={folder.id}>
              <div
                className={`flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 transition ${
                  folderDropActive
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] ring-2 ring-[var(--color-accent)]"
                    : ""
                }`}
                onDragOver={(e) => handleObjectDragOver(e, folder.id)}
                onDragLeave={(e) => handleObjectDragLeave(e, folder.id)}
                onDrop={(e) => void handleObjectDrop(e, folder.id)}
              >
                <button
                  type="button"
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left hover:text-[var(--color-accent)]"
                  onClick={() => onNavigate(folder.id)}
                  aria-label={`Open folder ${folder.name}`}
                >
                  <Folder className="h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden />
                  <span className="truncate font-medium">{folder.name}</span>
                </button>
                {canWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Rename folder ${folder.name}`}
                      onClick={() => {
                        setRenameFolder(folder);
                        setRenameName(folder.name);
                        setError(null);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete folder ${folder.name}`}
                      onClick={() => setDeleteFolder(folder)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
          })}
        </ul>
      ) : null}

      {createOpen ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            setLoading(true);
            setError(null);
            try {
              await apiClient.post("/api/core/drive/folders", {
                name: newName.trim(),
                parentId: currentFolderId,
              });
              await refreshFolders();
              setCreateOpen(false);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not create folder");
            } finally {
              setLoading(false);
            }
          }}
        >
          <label className="min-w-[12rem] flex-1 space-y-1">
            <span className="text-sm font-medium">Folder name</span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New folder name"
              required
              disabled={loading}
              autoFocus
            />
          </label>
          <Button type="submit" size="sm" loading={loading} disabled={!newName.trim()}>
            Create
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => setCreateOpen(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {renameFolder ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!renameName.trim()) return;
            setLoading(true);
            setError(null);
            try {
              await apiClient.patch(`/api/core/drive/folders/${renameFolder.id}`, {
                name: renameName.trim(),
              });
              await refreshFolders();
              setRenameFolder(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not rename folder");
            } finally {
              setLoading(false);
            }
          }}
        >
          <label className="min-w-[12rem] flex-1 space-y-1">
            <span className="text-sm font-medium">Rename folder</span>
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              aria-label="Folder name"
              required
              disabled={loading}
              autoFocus
            />
          </label>
          <Button type="submit" size="sm" loading={loading} disabled={!renameName.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => setRenameFolder(null)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      <ConfirmDialog
        open={deleteFolder !== null}
        title="Delete folder?"
        message="Only empty folders can be deleted. Move or delete items inside first."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteFolder) return;
          const id = deleteFolder.id;
          setDeleteFolder(null);
          setError(null);
          try {
            await apiClient.delete(`/api/core/drive/folders/${id}`);
            await refreshFolders();
            if (currentFolderId === id) onNavigate(null);
          } catch (err) {
            setError(
              err instanceof ApiError && err.message.includes("folder_not_empty")
                ? "Folder is not empty"
                : "Could not delete folder",
            );
          }
        }}
        onCancel={() => setDeleteFolder(null)}
      />
    </div>
  );
}
