export const DRIVE_FOLDER_NAME_MAX_LEN = 256;

export type DriveFolderRow = {
  id: string;
  name: string;
  parentId: string | null;
};

export function normalizeFolderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name) return null;
  return name.slice(0, DRIVE_FOLDER_NAME_MAX_LEN);
}

export function buildFolderBreadcrumb(
  folders: DriveFolderRow[],
  folderId: string | null,
): { id: string | null; name: string }[] {
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "Drive" }];
  if (!folderId) return crumbs;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: { id: string; name: string }[] = [];
  let current = byId.get(folderId);
  while (current) {
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return [...crumbs, ...path];
}

export function childFolders(folders: DriveFolderRow[], parentId: string | null): DriveFolderRow[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
