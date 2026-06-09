"use client";

import { Folder } from "lucide-react";
import { useMemo } from "react";
import type { DriveFolder } from "../lib/drive-types";
import {
  buildFolderBreadcrumbItems,
  childFoldersForParent,
} from "../lib/drive-folders-ui";

export function DrivePickerFolderNav({
  folders,
  currentFolderId,
  onNavigate,
}: {
  folders: DriveFolder[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
}) {
  const breadcrumbItems = useMemo(
    () => buildFolderBreadcrumbItems(folders, currentFolderId),
    [folders, currentFolderId],
  );

  const childFolders = useMemo(
    () => childFoldersForParent(folders, currentFolderId),
    [folders, currentFolderId],
  );

  return (
    <div className="space-y-2">
      <nav aria-label="Drive folder location">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-[var(--color-text-muted)]">
          {breadcrumbItems.map((item, i) => {
            const isLast = i === breadcrumbItems.length - 1;
            return (
              <li key={`${item.folderId ?? "root"}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden>/</span> : null}
                {isLast ? (
                  <span className="text-[var(--color-text)]">{item.label}</span>
                ) : (
                  <button
                    type="button"
                    className="hover:text-[var(--color-text)]"
                    onClick={() => onNavigate(item.folderId)}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {childFolders.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Folders">
          {childFolders.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
                onClick={() => onNavigate(folder.id)}
                aria-label={`Open folder ${folder.name}`}
              >
                <Folder className="h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden />
                <span className="truncate font-medium">{folder.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
