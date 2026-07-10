"use client";

import { ExternalLink, FileText } from "lucide-react";
import {
  displayArtifactFileName,
  isImageArtifactName,
  lineageBadgeLabel,
  lineageBadgeTone,
  schoolArtifactFileUrl,
} from "../lib/school-artifact-url";
import { AnchorButton } from "./ui/LinkButton";
import { Badge } from "./ui";

type Artifact = {
  id: string;
  artifactType: string;
  s3Key: string | null;
  url: string | null;
  googleFileId?: string | null;
  openUrl?: string | null;
  displayName?: string | null;
  lineageStatus?: string | null;
  lineageDetail?: string | null;
};

export function SchoolSubmissionArtifacts({
  artifacts,
  showPreview = false,
  showLineage = false,
  emptyMessage = "No files attached.",
}: {
  artifacts: Artifact[];
  showPreview?: boolean;
  showLineage?: boolean;
  emptyMessage?: string;
}) {
  if (artifacts.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2" aria-label="Submitted files">
        {artifacts.map((artifact) => {
          const name = displayArtifactFileName(artifact);
          const href = schoolArtifactFileUrl(artifact);
          const lineageLabel = showLineage ? lineageBadgeLabel(artifact.lineageStatus) : null;
          return (
            <li
              key={artifact.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
                  <span className="min-w-0 truncate">{name}</span>
                </div>
                {lineageLabel ? (
                  <Badge tone={lineageBadgeTone(artifact.lineageStatus)}>{lineageLabel}</Badge>
                ) : null}
                {showLineage && artifact.lineageDetail ? (
                  <p className="text-xs text-[var(--color-text-muted)]">{artifact.lineageDetail}</p>
                ) : null}
              </div>
              <AnchorButton href={href} target="_blank" rel="noopener noreferrer" size="sm" variant="secondary">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open
              </AnchorButton>
            </li>
          );
        })}
      </ul>

      {showPreview && (
        <div className="grid gap-3 sm:grid-cols-2">
          {artifacts.map((artifact) => {
            const name = displayArtifactFileName(artifact);
            if (!isImageArtifactName(name)) return null;
            const href = schoolArtifactFileUrl(artifact);
            return (
              <a
                key={`preview-${artifact.id}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:border-[var(--color-accent)]/50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={href}
                  alt={`Preview of ${name}`}
                  className="max-h-80 w-full object-contain bg-black/20"
                />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
