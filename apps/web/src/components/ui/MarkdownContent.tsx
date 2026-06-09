"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn";
import {
  contentHasDriveEmbeds,
  DRIVE_EMBED_LINK_PREFIX,
  DRIVE_EMBED_MISSING_PREFIX,
  prepareMarkdownSourceForRender,
  preprocessDriveEmbedsForMarkdown,
} from "../../lib/drive-embeds";
import type { DriveEmbedObject } from "../../lib/drive-types";
import { DriveEmbedImage, DriveEmbedInline } from "../DriveAttachmentChips";

function driveEmbedUrlTransform(url: string): string {
  if (url.startsWith(DRIVE_EMBED_LINK_PREFIX) || url.startsWith(DRIVE_EMBED_MISSING_PREFIX)) {
    return url;
  }
  return defaultUrlTransform(url);
}

function embedLabelFromChildren(children: ReactNode, fallback: string): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === "string") {
    return children[0];
  }
  return fallback;
}

export function MarkdownContent({
  source,
  className,
  driveEmbeds,
}: {
  source: string;
  className?: string;
  driveEmbeds?: Record<string, DriveEmbedObject>;
}) {
  const trimmed = source.trim();
  if (!trimmed) return null;

  const embedMap = driveEmbeds ?? {};
  const prepared = prepareMarkdownSourceForRender(trimmed);
  const markdownSource = contentHasDriveEmbeds(prepared)
    ? preprocessDriveEmbedsForMarkdown(prepared, embedMap)
    : prepared;

  return (
    <div className={cn("markdown-content text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={driveEmbedUrlTransform}
        components={{
          a: ({ href, children, ...props }) => {
            if (href?.startsWith(DRIVE_EMBED_LINK_PREFIX)) {
              const id = href.slice(DRIVE_EMBED_LINK_PREFIX.length);
              const obj = embedMap[id];
              const label = embedLabelFromChildren(children, obj?.title ?? "Drive file");
              return <DriveEmbedInline object={obj ?? null} label={label} />;
            }
            if (href?.startsWith(DRIVE_EMBED_MISSING_PREFIX)) {
              const label = embedLabelFromChildren(children, "Drive file");
              return <DriveEmbedInline object={null} label={label} />;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
          img: ({ src, alt, ...props }) => {
            const href = typeof src === "string" ? src : undefined;
            if (href?.startsWith(DRIVE_EMBED_LINK_PREFIX)) {
              const id = href.slice(DRIVE_EMBED_LINK_PREFIX.length);
              const obj = embedMap[id];
              return (
                <DriveEmbedImage
                  object={obj ?? null}
                  alt={alt ?? obj?.title ?? "Drive file"}
                />
              );
            }
            if (href?.startsWith(DRIVE_EMBED_MISSING_PREFIX)) {
              return <DriveEmbedInline object={null} label={alt ?? "Drive file"} />;
            }
            return <img src={src} alt={alt} {...props} />;
          },
        }}
      >
        {markdownSource}
      </ReactMarkdown>
    </div>
  );
}
