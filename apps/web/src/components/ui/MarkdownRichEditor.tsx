"use client";

import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import type { Editor } from "@tiptap/react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DriveEmbedAutocompletePopover } from "../DriveEmbedAutocompletePopover";
import { ApiError, apiClient } from "../../lib/client-api";
import { cn } from "../../lib/cn";
import { findDriveEmbedTrigger } from "../../lib/drive-embed-autocomplete";
import {
  driveEmbedDragMimePresent,
  driveEmbedMarkdownFromPayload,
  parseDriveEmbedDragPayload,
} from "../../lib/drive-embed-drag";
import {
  formatDriveEmbed,
  prepareMarkdownSourceForRender,
  shieldDriveEmbedsForRichEditor,
} from "../../lib/drive-embeds";
import type { DriveObject } from "../../lib/drive-types";
import { IconButton } from "./IconButton";

function promptForLink(existingHref?: string | null): string | null {
  const url = window.prompt("Link URL", existingHref ?? "https://");
  if (url === null) return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface RichDriveEmbedTrigger {
  docStart: number;
  docEnd: number;
  searchQuery: string;
}

function findRichDriveEmbedTrigger(editor: Editor): RichDriveEmbedTrigger | null {
  const { from } = editor.state.selection;
  const textBefore = editor.state.doc.textBetween(0, from, "\n");
  const trigger = findDriveEmbedTrigger(textBefore, textBefore.length);
  if (!trigger) return null;
  const docStart = from - (textBefore.length - trigger.start);
  return { docStart, docEnd: from, searchQuery: trigger.searchQuery };
}

function sortObjects(list: DriveObject[]): DriveObject[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function MarkdownRichEditor({
  value,
  onChange,
  disabled,
  placeholder = "Write your note…",
  "aria-label": ariaLabel = "Note content",
  minHeightClass = "min-h-[6.5rem]",
  driveEmbedAutocomplete = false,
  driveEmbedDrop = false,
}: {
  value: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  minHeightClass?: string;
  driveEmbedAutocomplete?: boolean;
  driveEmbedDrop?: boolean;
}) {
  const labelId = useId();
  const editorId = useId();
  const [trigger, setTrigger] = useState<RichDriveEmbedTrigger | null>(null);
  const [objects, setObjects] = useState<DriveObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<{ top: number; left: number; height: number } | null>(
    null,
  );
  const fetchGen = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const isSettingContentRef = useRef(false);
  const triggerRef = useRef<RichDriveEmbedTrigger | null>(null);
  const objectsRef = useRef<DriveObject[]>([]);
  const activeIndexRef = useRef(0);
  const selectObjectRef = useRef<(object: DriveObject) => void>(() => {});
  const driveEmbedDropRef = useRef(driveEmbedDrop);

  useEffect(() => {
    driveEmbedDropRef.current = driveEmbedDrop;
  }, [driveEmbedDrop]);

  useEffect(() => {
    triggerRef.current = trigger;
  }, [trigger]);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const syncAutocomplete = useCallback(
    (editor: Editor) => {
      if (!driveEmbedAutocomplete || disabled) {
        setTrigger(null);
        setAnchor(null);
        return;
      }
      const found = findRichDriveEmbedTrigger(editor);
      setTrigger(found);
      if (!found) {
        setAnchor(null);
        return;
      }
      const coords = editor.view.coordsAtPos(found.docEnd);
      setAnchor({ top: coords.top, left: coords.left, height: coords.bottom - coords.top });
    },
    [driveEmbedAutocomplete, disabled],
  );

  const selectObject = useCallback(
    (object: DriveObject) => {
      const editor = editorRef.current;
      const activeTrigger = triggerRef.current;
      if (!editor || !activeTrigger) return;
      const embed = shieldDriveEmbedsForRichEditor(
        formatDriveEmbed(object.id, object.filename ?? object.title),
      );
      editor
        .chain()
        .focus()
        .deleteRange({ from: activeTrigger.docStart, to: activeTrigger.docEnd })
        .insertContent(embed)
        .run();
      setTrigger(null);
      setObjects([]);
      setAnchor(null);
    },
    [],
  );

  useEffect(() => {
    selectObjectRef.current = selectObject;
  }, [selectObject]);

  useEffect(() => {
    if (!trigger) {
      setObjects([]);
      setLoading(false);
      return;
    }

    const generation = ++fetchGen.current;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (trigger.searchQuery.trim()) params.set("q", trigger.searchQuery.trim());
      const qs = params.toString();
      void apiClient
        .get<{ objects: DriveObject[] }>(`/api/core/drive/objects${qs ? `?${qs}` : ""}`)
        .then((data) => {
          if (generation !== fetchGen.current) return;
          setObjects(sortObjects(data.objects).slice(0, 12));
          setActiveIndex(0);
        })
        .catch((err) => {
          if (generation !== fetchGen.current) return;
          setObjects([]);
          if (err instanceof ApiError) {
            /* keep typing */
          }
        })
        .finally(() => {
          if (generation === fetchGen.current) setLoading(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [trigger?.docStart, trigger?.docEnd, trigger?.searchQuery]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        shouldAutoLink: (url) => !/^drive:/i.test(url),
      }),
      Markdown,
    ],
    content: shieldDriveEmbedsForRichEditor(value || ""),
    contentType: "markdown",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      if (isSettingContentRef.current) return;
      const markdown = prepareMarkdownSourceForRender(ed.getMarkdown());
      if (!markdown.trim() && value.trim()) return;
      onChange(markdown);
      syncAutocomplete(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      syncAutocomplete(ed);
    },
    editorProps: {
      attributes: {
        id: editorId,
        class: cn(
          "note-rich-editor__content markdown-content px-3 py-2.5 text-sm outline-none",
          minHeightClass,
        ),
        "aria-labelledby": labelId,
        "data-placeholder": placeholder,
        ...(driveEmbedAutocomplete && !disabled
          ? {
              "aria-autocomplete": "list",
              "aria-expanded": trigger ? "true" : "false",
            }
          : {}),
      },
      handleKeyDown: (_view, event) => {
        const activeTrigger = triggerRef.current;
        if (!activeTrigger) return false;

        if (event.key === "Escape") {
          setTrigger(null);
          setAnchor(null);
          event.preventDefault();
          return true;
        }

        const options = objectsRef.current;
        const hasOptions = options.length > 0;
        if (!hasOptions && event.key !== "ArrowDown") return false;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (hasOptions) {
            setActiveIndex((i) => Math.min(i + 1, options.length - 1));
          }
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          if (!hasOptions) return false;
          event.preventDefault();
          const picked = options[activeIndexRef.current];
          if (picked) selectObjectRef.current(picked);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        dragover: (_view, event) => {
          if (!driveEmbedDropRef.current || disabled) return false;
          if (driveEmbedDragMimePresent(event.dataTransfer)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        drop: (view, event) => {
          if (!driveEmbedDropRef.current || disabled) return false;
          const payload = parseDriveEmbedDragPayload(event.dataTransfer);
          if (!payload) return false;
          event.preventDefault();
          const editor = editorRef.current;
          if (!editor) return true;
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!coords) return true;
          const embed = shieldDriveEmbedsForRichEditor(driveEmbedMarkdownFromPayload(payload));
          editor.chain().focus().insertContentAt(coords.pos, embed).run();
          return true;
        },
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const current = prepareMarkdownSourceForRender(editor.getMarkdown());
    if (current !== value) {
      isSettingContentRef.current = true;
      editor.commands.setContent(shieldDriveEmbedsForRichEditor(value || ""), {
        emitUpdate: false,
        contentType: "markdown",
      });
      isSettingContentRef.current = false;
    }
  }, [editor, value]);

  function setLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = promptForLink(previous);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  if (!editor) {
    return (
      <div
        className={cn(
          "note-rich-editor rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-sm text-[var(--color-text-muted)]",
          minHeightClass,
        )}
      >
        Loading editor…
      </div>
    );
  }

  return (
    <div
      className={cn(
        "note-rich-editor overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)]",
        disabled && "opacity-60",
      )}
    >
      {!disabled && (
        <div
          className="flex flex-wrap gap-0.5 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/50 px-1 py-1"
          role="toolbar"
          aria-label="Note formatting"
        >
          <IconButton
            label="Bold (Ctrl+B)"
            className={cn(editor.isActive("bold") && "bg-[var(--color-border)]/50")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <span className="text-xs font-bold">B</span>
          </IconButton>
          <IconButton
            label="Italic (Ctrl+I)"
            className={cn(editor.isActive("italic") && "bg-[var(--color-border)]/50")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <span className="text-xs italic">I</span>
          </IconButton>
          <IconButton
            label="Heading 2"
            className={cn(
              editor.isActive("heading", { level: 2 }) && "bg-[var(--color-border)]/50",
            )}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <span className="text-xs font-semibold">H</span>
          </IconButton>
          <IconButton
            label="Bullet list"
            className={cn(editor.isActive("bulletList") && "bg-[var(--color-border)]/50")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <span className="text-xs">• List</span>
          </IconButton>
          <IconButton
            label="Numbered list"
            className={cn(editor.isActive("orderedList") && "bg-[var(--color-border)]/50")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <span className="text-xs">1. List</span>
          </IconButton>
          <IconButton
            label="Link"
            className={cn(editor.isActive("link") && "bg-[var(--color-border)]/50")}
            onClick={setLink}
          >
            <span className="text-xs underline">Link</span>
          </IconButton>
        </div>
      )}
      <span id={labelId} className="sr-only">
        {ariaLabel}
      </span>
      <EditorContent editor={editor} />
      {driveEmbedAutocomplete && !disabled ? (
        <DriveEmbedAutocompletePopover
          open={!!trigger}
          loading={loading}
          objects={objects}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onSelect={selectObject}
          anchor={anchor}
          inputId={editorId}
        />
      ) : null}
    </div>
  );
}
