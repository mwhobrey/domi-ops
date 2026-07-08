/** Persisted in import_records — do not rename legacy value without a data migration. */
export const LEGACY_IMPORT_MARKER_SOURCE = "whome";

/** Current import household marker (source_table + source_id). */
export const IMPORT_MARKER_SOURCE = "domi-ops";
export const IMPORT_MARKER_ID = "household";

export const IMPORT_MARKER_SOURCES = [
  IMPORT_MARKER_SOURCE,
  LEGACY_IMPORT_MARKER_SOURCE,
] as const;
