/** Match API `slugCategoryKey` / import commit keys. */
export function slugCategoryKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (slug || "category").slice(0, 64);
}
