"use client";

import { Upload } from "lucide-react";

export function DriveDropOverlay({
  visible,
  folderLabel,
}: {
  visible: boolean;
  folderLabel: string;
}) {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]/80 p-6 backdrop-blur-sm"
      aria-hidden
    >
      <div className="flex max-w-md flex-col items-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-surface)] px-8 py-10 text-center shadow-lg">
        <Upload className="h-10 w-10 text-[var(--color-accent)]" aria-hidden />
        <p className="text-lg font-semibold text-[var(--color-text)]">Drop files to upload</p>
        <p className="text-sm text-[var(--color-text-muted)]">Uploading to: {folderLabel}</p>
      </div>
    </div>
  );
}
