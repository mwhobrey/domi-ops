import type { DriveFolder } from "./drive-types";

export type FolderBreadcrumbItem = { label: string; folderId: string | null };

/** Ancestor chain for folder navigation (root → current). */
export function buildFolderBreadcrumbItems(
  folders: DriveFolder[],
  folderId: string | null,
  rootLabel = "Drive",
): FolderBreadcrumbItem[] {
  const items: FolderBreadcrumbItem[] = [{ label: rootLabel, folderId: null }];
  if (!folderId) return items;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: DriveFolder[] = [];
  let current = byId.get(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  for (const folder of path) {
    items.push({ label: folder.name, folderId: folder.id });
  }
  return items;
}

export function childFoldersForParent(
  folders: DriveFolder[],
  parentId: string | null,
): DriveFolder[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function currentFolderLabel(
  folders: DriveFolder[],
  folderId: string | null,
): string {
  if (!folderId) return "Drive (root)";
  return folders.find((f) => f.id === folderId)?.name ?? "Unknown folder";
}

export function folderSelectOptions(
  folders: DriveFolder[],
): { id: string; label: string }[] {
  const byParent = new Map<string | null, DriveFolder[]>();
  for (const folder of folders) {
    const key = folder.parentId;
    const list = byParent.get(key) ?? [];
    list.push(folder);
    byParent.set(key, list);
  }
  const out: { id: string; label: string }[] = [{ id: "", label: "Drive (root)" }];
  function walk(parentId: string | null, depth: number) {
    const children = (byParent.get(parentId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    for (const child of children) {
      out.push({ id: child.id, label: `${"— ".repeat(depth)}${child.name}` });
      walk(child.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export const DRIVE_OBJECT_DRAG_TYPE = "application/x-whome-drive-object";

export function isExternalFileDrag(e: React.DragEvent | DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}
