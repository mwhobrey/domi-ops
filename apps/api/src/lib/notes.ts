import type { Database } from "@domi-ops/db";
import { notes, type notes as notesTable } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";

const NOTE_TITLE_MAX_LEN = 256;

export function deriveNoteTitleFromContent(content: string): string {
  const firstLine =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  if (firstLine) return firstLine.slice(0, NOTE_TITLE_MAX_LEN);
  const trimmed = content.trim();
  if (trimmed) return trimmed.slice(0, NOTE_TITLE_MAX_LEN);
  return "Untitled";
}

export function normalizeNoteTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (!title) return null;
  return title.slice(0, NOTE_TITLE_MAX_LEN);
}

export function noteMatchesSearch(title: string, content: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    title.toLowerCase().includes(needle) || content.toLowerCase().includes(needle)
  );
}

export function parseNoteTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    }
  } catch {
    // ignore invalid JSON
  }
  return [];
}

export function serializeNoteTagsJson(tags: string[] = []): string {
  const parts = tags.map((t) => t.trim()).filter(Boolean);
  return JSON.stringify(parts);
}

export function noteHasTag(tagsJson: string | null | undefined, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return parseNoteTagsJson(tagsJson).some((t) => t.toLowerCase() === needle);
}

export async function collectNoteTagSuggestions(
  db: Database,
  householdId: string,
  q: string,
): Promise<string[]> {
  const rows = await db
    .select({ tagsJson: notes.tagsJson })
    .from(notes)
    .where(eq(notes.householdId, householdId));

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const needle = q.trim().toLowerCase();

  for (const row of rows) {
    for (const tag of parseNoteTagsJson(row.tagsJson)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      if (needle && !key.includes(needle)) continue;
      seen.add(key);
      suggestions.push(tag);
    }
  }

  suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return suggestions.slice(0, 25);
}

export function serializeNoteTags(row: typeof notesTable.$inferSelect): string[] {
  return parseNoteTagsJson(row.tagsJson);
}
