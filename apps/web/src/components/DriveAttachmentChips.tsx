"use client";

import { ExternalLink, FileText, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  driveEmbedInsertLabel,
  DRIVE_EMBED_DRAG_TYPE,
  encodeDriveEmbedDragPayload,
} from "../lib/drive-embed-drag";
import { formatDriveEmbed } from "../lib/drive-embeds";
import type { DriveEmbedObject, DriveObject, DriveReference } from "../lib/drive-types";
import { driveEmbedToObject } from "../lib/drive-types";
import { AnchorButton, Badge, Button } from "./ui";

export function DriveAttachmentChips({
  references,
  onRemove,
  removingId,
  draggable = false,
}: {
  references: DriveReference[];
  onRemove?: (referenceId: string) => void;
  removingId?: string | null;
  /** Allow dragging chips into note body as `[[drive:…]]` embeds. */
  draggable?: boolean;
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
          draggable={draggable}
        />
      ))}
    </ul>
  );
}

function DriveAttachmentChip({
  reference,
  onRemove,
  removing,
  draggable = false,
}: {
  reference: DriveReference;
  onRemove?: () => void;
  removing?: boolean;
  draggable?: boolean;
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

  const embedLabel = driveEmbedInsertLabel(obj);

  return (
    <li
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] pl-2 pr-1 py-1 text-sm"
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              const payload = { id: obj.id, label: embedLabel };
              e.dataTransfer.setData(DRIVE_EMBED_DRAG_TYPE, encodeDriveEmbedDragPayload(payload));
              e.dataTransfer.setData("text/plain", formatDriveEmbed(obj.id, embedLabel));
              e.dataTransfer.effectAllowed = "copy";
            }
          : undefined
      }
    >
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
        draggable={false}
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

/** Inline chip for `[[drive:uuid|label]]` embeds inside note markdown. */
export function DriveEmbedInline({
  object,
  label,
}: {
  object: DriveEmbedObject | null;
  label: string;
}) {
  if (!object) {
    return (
      <span className="inline-flex align-middle">
        <Badge tone="warning">File removed</Badge>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  const obj = driveEmbedToObject(object);
  const href =
    obj.kind === "file"
      ? `/api/core/drive/objects/${obj.id}/file`
      : obj.url ?? `/drive?highlight=${obj.id}`;

  return (
    <span className="inline-flex max-w-full align-middle items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-sm">
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
            {label}
          </>
        ) : (
          label
        )}
      </AnchorButton>
    </span>
  );
}

/** Inline image for image Drive embeds inside note markdown. */
export function DriveEmbedImage({
  object,
  alt,
}: {
  object: DriveEmbedObject | null;
  alt: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!object) {
      setBlobUrl(null);
      setLoadFailed(false);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    setLoadFailed(false);
    setBlobUrl(null);
    const fileUrl = `/api/core/drive/objects/${object.id}/file`;
    void fetch(fileUrl, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`drive_file_${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [object?.id]);

  if (!object) {
    return (
      <span className="my-2 inline-flex align-middle">
        <Badge tone="warning">File removed</Badge>
        <span className="sr-only">{alt}</span>
      </span>
    );
  }

  if (loadFailed) {
    return (
      <span className="my-2 inline-flex align-middle">
        <Badge tone="warning">Could not load image</Badge>
        <span className="sr-only">{alt}</span>
      </span>
    );
  }

  if (!blobUrl) {
    return (
      <span className="my-2 block max-w-full text-xs text-[var(--color-text-muted)]" aria-busy>
        Loading image…
      </span>
    );
  }

  return (
    <span className="my-2 block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- blob URL from credentialed fetch */}
      <img
        src={blobUrl}
        alt={alt}
        loading="lazy"
        className="max-h-96 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border)] object-contain"
      />
    </span>
  );
}
