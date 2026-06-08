"use client";

import { ExternalLink, FileText, Link2, X } from "lucide-react";
import type { DriveObject, DriveReference } from "../lib/drive-types";
import { AnchorButton, Badge, Button } from "./ui";

export function DriveAttachmentChips({
  references,
  onRemove,
  removingId,
}: {
  references: DriveReference[];
  onRemove?: (referenceId: string) => void;
  removingId?: string | null;
}) {
  if (references.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Drive attachments">
      {references.map((ref) => (
        <DriveAttachmentChip
          key={ref.id}
          reference={ref}
          onRemove={onRemove ? () => onRemove(ref.id) : undefined}
          removing={removingId === ref.id}
        />
      ))}
    </ul>
  );
}

function DriveAttachmentChip({
  reference,
  onRemove,
  removing,
}: {
  reference: DriveReference;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const obj = reference.object;
  if (!obj) {
    return (
      <li>
        <Badge tone="warning">File removed</Badge>
      </li>
    );
  }

  const href =
    obj.kind === "file"
      ? `/api/core/drive/objects/${obj.id}/file`
      : obj.url ?? `/drive?highlight=${obj.id}`;

  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] pl-2 pr-1 py-1 text-sm">
      <span className="text-[var(--color-accent)]" aria-hidden>
        {obj.kind === "link" ? <Link2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
      </span>
      <AnchorButton
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        variant="ghost"
        size="sm"
        className="h-auto min-h-0 max-w-[12rem] truncate px-1 py-0 text-sm font-medium"
        aria-label={`Open ${obj.title}`}
      >
        {obj.kind === "link" && obj.url ? (
          <>
            <ExternalLink className="mr-1 inline h-3 w-3" aria-hidden />
            {obj.title}
          </>
        ) : (
          obj.title
        )}
      </AnchorButton>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 min-h-0 shrink-0 rounded-full p-0"
          aria-label={`Remove attachment ${obj.title}`}
          loading={removing}
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

export function driveObjectChipLabel(obj: DriveObject): string {
  return obj.filename ? `${obj.title} (${obj.filename})` : obj.title;
}
