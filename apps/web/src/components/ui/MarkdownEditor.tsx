"use client";

import { useCallback, useId, useRef, useState } from "react";
import { DriveEmbedAutocompletePopover } from "../DriveEmbedAutocompletePopover";
import { useDriveEmbedAutocomplete } from "../../hooks/useDriveEmbedAutocomplete";
import { cn } from "../../lib/cn";
import { getTextareaCaretScreenPosition } from "../../lib/drive-embed-autocomplete";
import {
  driveEmbedDragMimePresent,
  driveEmbedMarkdownFromPayload,
  parseDriveEmbedDragPayload,
} from "../../lib/drive-embed-drag";
import type { DriveEmbedObject } from "../../lib/drive-types";
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
  driveEmbeds,
  driveEmbedAutocomplete = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  minRows?: number;
  defaultMode?: EditorMode;
  driveEmbeds?: Record<string, DriveEmbedObject>;
  /** Show `[[` Drive file autocomplete (requires drive module). */
  driveEmbedAutocomplete?: boolean;
}) {
  const [mode, setMode] = useState<EditorMode>(defaultMode);
  const labelId = useId();
  const writePanelId = useId();
  const richPanelId = useId();
  const previewPanelId = useId();
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; height: number } | null>(
    null,
  );

  const getCursor = useCallback(
    () => textareaRef.current?.selectionStart ?? value.length,
    [value.length],
  );

  const setCursor = useCallback((pos: number) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
  }, []);

  const updateAnchor = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setAnchor(null);
      return;
    }
    const pos = el.selectionStart ?? 0;
    setAnchor(getTextareaCaretScreenPosition(el, pos));
  }, []);

  const autocompleteEnabled = driveEmbedAutocomplete && !disabled;
  const autocomplete = useDriveEmbedAutocomplete({
    enabled: autocompleteEnabled && mode === "write",
    value,
    onChange,
    getCursor,
    setCursor,
    onAnchorChange: setAnchor,
  });

  const syncAutocomplete = useCallback(() => {
    const found = autocomplete.syncTrigger();
    if (found) updateAnchor();
  }, [autocomplete, updateAnchor]);

  const insertDriveEmbedAtCursor = useCallback(
    (embed: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? start;
      const next = value.slice(0, start) + embed + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => setCursor(start + embed.length));
    },
    [onChange, setCursor, value],
  );

  const handleDriveEmbedDrop = useCallback(
    (event: React.DragEvent) => {
      if (!autocompleteEnabled) return;
      const payload = parseDriveEmbedDragPayload(event.dataTransfer);
      if (!payload) return;
      event.preventDefault();
      insertDriveEmbedAtCursor(driveEmbedMarkdownFromPayload(payload));
    },
    [autocompleteEnabled, insertDriveEmbedAtCursor],
  );

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

  const showAutocomplete = autocomplete.open && mode === "write";

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
        <div id={writePanelId} role="tabpanel" aria-labelledby={labelId} className="relative">
          <Textarea
            ref={textareaRef}
            id={textareaId}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              requestAnimationFrame(syncAutocomplete);
            }}
            onKeyDown={(e) => {
              if (autocomplete.handleKeyDown(e)) return;
            }}
            onKeyUp={syncAutocomplete}
            onClick={syncAutocomplete}
            onSelect={syncAutocomplete}
            onScroll={updateAnchor}
            onDragOver={(e) => {
              if (autocompleteEnabled && driveEmbedDragMimePresent(e.dataTransfer)) {
                e.preventDefault();
              }
            }}
            onDrop={handleDriveEmbedDrop}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-expanded={showAutocomplete}
            aria-controls={showAutocomplete ? `${textareaId}-autocomplete` : undefined}
            aria-autocomplete={autocompleteEnabled ? "list" : undefined}
            role={autocompleteEnabled ? "combobox" : undefined}
            rows={minRows}
            className="font-mono text-[13px] leading-relaxed"
          />
          {autocompleteEnabled ? (
            <DriveEmbedAutocompletePopover
              open={showAutocomplete}
              loading={autocomplete.loading}
              objects={autocomplete.objects}
              activeIndex={autocomplete.activeIndex}
              onActiveIndexChange={autocomplete.setActiveIndex}
              onSelect={autocomplete.selectObject}
              anchor={anchor}
              inputId={textareaId}
            />
          ) : null}
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Supports **bold**, _italic_, lists, links, and `code`.
            {autocompleteEnabled ? " Type [[ to link a Drive file." : null}
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
            driveEmbedAutocomplete={autocompleteEnabled}
            driveEmbedDrop={autocompleteEnabled}
          />
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Rich mode saves Markdown. Use Write for raw syntax or Preview to check rendering.
            {autocompleteEnabled ? " Type [[ to link a Drive file." : null}
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
            <MarkdownContent source={value} driveEmbeds={driveEmbeds} />
          ) : (
            <p className="text-sm">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
