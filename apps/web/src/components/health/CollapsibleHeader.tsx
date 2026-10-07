"use client";

import type { ReactNode } from "react";

/**
 * A section title that folds its section away (WHO-447). The title is a button inside the heading, so a screen reader hears
 * "expanded" or "collapsed"; while folded, a one-line summary says what is inside without opening it.
 */
export function CollapsibleHeader({
  id,
  title,
  collapsed,
  onToggle,
  summary,
}: {
  /** Ties the button to the body it folds: the body has the id `${id}-body`. */
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  summary?: ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h2 className="text-label text-[var(--color-text-muted)]">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={`${id}-body`}
          onClick={onToggle}
          className="-ml-1 flex items-center gap-2 rounded-md px-1 py-1 text-left uppercase hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 4l6 6-6 6" />
          </svg>
          {title}
        </button>
      </h2>
      {collapsed && summary ? <p className="break-words pl-6 text-sm text-[var(--color-text-muted)]">{summary}</p> : null}
    </div>
  );
}
