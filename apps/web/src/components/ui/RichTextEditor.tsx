"use client";

import dynamic from "next/dynamic";
import { cn } from "../../lib/cn";
import { sanitizeEventHtml } from "../../lib/event-html";

/**
 * TipTap is ~200 KB gzipped; load it only when an editor actually renders instead of on every
 * page that imports from the ui barrel.
 */
export const RichTextEditor = dynamic(
  () => import("./RichTextEditorImpl").then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div
        className="min-h-[6.5rem] animate-pulse rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/40"
        aria-hidden
      />
    ),
  },
);

export function RichTextContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const safe = sanitizeEventHtml(html);
  if (!safe) return null;
  return (
    <div
      className={cn("event-rich-content text-sm leading-relaxed", className)}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
