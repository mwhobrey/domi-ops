/** Relative in-app path only — blocks open redirects. */
export function safeAppRedirectPath(next: string | undefined | null): string | null {
  if (!next?.trim()) return null;
  const path = next.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.includes("\\") || path.includes("\0")) return null;
  return path;
}
