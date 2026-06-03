export function loadErrorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
