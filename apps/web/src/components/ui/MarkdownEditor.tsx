"use client";

import { useId, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { MarkdownContent } from "./MarkdownContent";
import { MarkdownRichEditor } from "./MarkdownRichEditor";
import { Textarea } from "./Textarea";

type EditorMode = "write" | "rich" | "preview";

export function MarkdownEditor({
  value,
  onChange,
  disabled,
  placeholder = "Write in Markdown…",
  "aria-label": ariaLabel = "Note content",
  minRows = 4,
  defaultMode = "rich",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  minRows?: number;
  defaultMode?: EditorMode;
}) {
  const [mode, setMode] = useState<EditorMode>(defaultMode);
  const labelId = useId();
  const writePanelId = useId();
  const richPanelId = useId();
  const previewPanelId = useId();

  const tabs = [
    { id: "write" as const, label: "Write" },
    { id: "rich" as const, label: "Rich" },
    { id: "preview" as const, label: "Preview" },
  ] as const;

  function panelId(tab: EditorMode) {
    if (tab === "write") return writePanelId;
    if (tab === "rich") return richPanelId;
    return previewPanelId;
  }

  return (
    <div className="space-y-2">
      <div
        className="flex rounded-[var(--radius-lg)] border border-[var(--color-border)] p-0.5"
        role="tablist"
        aria-label="Editor mode"
      >
        {tabs.map(({ id, label }) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={mode === id ? "primary" : "ghost"}
            role="tab"
            aria-selected={mode === id}
            aria-controls={panelId(id)}
            disabled={disabled}
            onClick={() => setMode(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <span id={labelId} className="sr-only">
        {ariaLabel}
      </span>

      {mode === "write" ? (
        <div id={writePanelId} role="tabpanel" aria-labelledby={labelId}>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={ariaLabel}
            rows={minRows}
            className="font-mono text-[13px] leading-relaxed"
          />
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Supports **bold**, _italic_, lists, links, and `code`.
          </p>
        </div>
      ) : mode === "rich" ? (
        <div id={richPanelId} role="tabpanel" aria-labelledby={labelId}>
          <MarkdownRichEditor
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            minHeightClass={minRows >= 8 ? "min-h-[12rem]" : "min-h-[6.5rem]"}
          />
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Rich mode saves Markdown. Use Write for raw syntax or Preview to check rendering.
          </p>
        </div>
      ) : (
        <div
          id={previewPanelId}
          role="tabpanel"
          className={cn(
            "min-h-[6.5rem] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/40 px-3 py-2.5",
            !value.trim() && "text-[var(--color-text-muted)]",
          )}
        >
          {value.trim() ? (
            <MarkdownContent source={value} />
          ) : (
            <p className="text-sm">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
