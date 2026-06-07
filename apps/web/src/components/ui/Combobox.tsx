"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export function Combobox({
  value,
  onChange,
  suggestions,
  onQueryChange,
  loading,
  placeholder,
  className,
  id: idProp,
  "aria-label": ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = suggestions.filter(
    (s) => !value.trim() || s.toLowerCase().includes(value.toLowerCase()),
  );
  const showList = open && filtered.length > 0;

  useEffect(() => {
    onQueryChange?.(value);
  }, [value, onQueryChange]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectSuggestion = useCallback(
    (s: string) => {
      onChange(s);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList && e.key === "ArrowDown" && filtered.length > 0) {
            setOpen(true);
            setActiveIndex(0);
            e.preventDefault();
            return;
          }
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            selectSuggestion(filtered[activeIndex]!);
          } else if (e.key === "Escape") {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        className={cn(
          "w-full rounded-[var(--radius-lg)] border bg-transparent px-3 py-2 text-sm",
          "border-[var(--color-border)] focus:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        )}
        autoComplete="off"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1 shadow-lg"
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                i === activeIndex && "bg-[var(--color-accent-subtle)]",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
      {loading ? (
        <span className="sr-only" aria-live="polite">
          Loading suggestions
        </span>
      ) : null}
    </div>
  );
}
