"use client";

import { FileText, Link2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import type { DriveObject } from "../lib/drive-types";

export function DriveEmbedAutocompletePopover({
  open,
  loading,
  objects,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  anchor,
  inputId,
}: {
  open: boolean;
  loading: boolean;
  objects: DriveObject[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (object: DriveObject) => void;
  anchor: { top: number; left: number; height: number } | null;
  inputId?: string;
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const option = listRef.current?.children.item(activeIndex) as HTMLElement | null;
    option?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      setPortalRoot(null);
      return;
    }
    const anchorEl = inputId ? document.getElementById(inputId) : null;
    const dialog = anchorEl?.closest("dialog") ?? document.querySelector("dialog[open]");
    setPortalRoot((dialog as HTMLElement | null) ?? document.body);
  }, [open, inputId, anchor?.top, anchor?.left]);

  if (!open || !anchor || !portalRoot) return null;

  const top = anchor.top + anchor.height + 4;
  const left = anchor.left;

  return createPortal(
    <div
      className="fixed z-[100] w-[min(20rem,calc(100vw-1.5rem))]"
      style={{ top, left }}
      role="presentation"
    >
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Drive files"
        aria-busy={loading}
        aria-activedescendant={
          activeIndex >= 0 && objects[activeIndex]
            ? `${listId}-option-${activeIndex}`
            : undefined
        }
        className="max-h-52 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1 shadow-lg"
      >
        {loading && objects.length === 0 ? (
          <li className="px-3 py-2 text-sm text-[var(--color-text-muted)]" role="presentation">
            Searching Drive…
          </li>
        ) : objects.length === 0 ? (
          <li className="px-3 py-2 text-sm text-[var(--color-text-muted)]" role="presentation">
            No matching Drive items
          </li>
        ) : (
          objects.map((obj, i) => (
            <li
              key={obj.id}
              id={`${listId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "flex cursor-pointer items-start gap-2 px-3 py-2 text-sm",
                i === activeIndex && "bg-[var(--color-accent-subtle)]",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onActiveIndexChange(i)}
              onClick={() => onSelect(obj)}
            >
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                aria-hidden
              >
                {obj.kind === "link" ? (
                  <Link2 className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-[var(--color-text)]">{obj.title}</span>
                {obj.filename ? (
                  <span className="block text-xs text-[var(--color-text-muted)]">{obj.filename}</span>
                ) : null}
                {(obj.tags ?? []).length > 0 ? (
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                    {(obj.tags ?? []).join(", ")}
                  </span>
                ) : null}
              </span>
            </li>
          ))
        )}
      </ul>
      <span className="sr-only" aria-live="polite">
        {loading
          ? "Loading Drive suggestions"
          : objects.length === 0
            ? "No Drive matches"
            : `${objects.length} Drive suggestions`}
      </span>
      {inputId ? (
        <span id={`${inputId}-autocomplete`} className="sr-only">
          Drive embed autocomplete
        </span>
      ) : null}
    </div>,
    portalRoot,
  );
}
