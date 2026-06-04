"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId } from "react";
import { cn } from "../../lib/cn";
import { sanitizeEventHtml } from "../../lib/event-html";
import { IconButton } from "./IconButton";

export function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder = "Notes, links, details…",
  "aria-label": ariaLabel = "Description",
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const labelId = useId();

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      onChange(sanitizeEventHtml(ed.getHTML()));
    },
    editorProps: {
      attributes: {
        class: "event-rich-editor__content min-h-[7rem] px-3 py-2.5 text-sm outline-none",
        "aria-labelledby": labelId,
        "data-placeholder": placeholder,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || "";
    if (sanitizeEventHtml(current) !== sanitizeEventHtml(next)) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div className="event-rich-editor rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-sm text-[var(--color-text-muted)]">
        Loading editor…
      </div>
    );
  }

  return (
    <div
      className={cn(
        "event-rich-editor overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)]",
        disabled && "opacity-60",
      )}
    >
      {!disabled && (
        <div
          className="flex flex-wrap gap-0.5 border-b border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)]/50 px-1 py-1"
          role="toolbar"
          aria-label="Formatting"
        >
          <IconButton
            label="Bold"
            className={cn(editor.isActive("bold") && "bg-[var(--color-border)]/50")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <span className="text-xs font-bold">B</span>
          </IconButton>
          <IconButton
            label="Italic"
            className={cn(editor.isActive("italic") && "bg-[var(--color-border)]/50")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <span className="text-xs italic">I</span>
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
        </div>
      )}
      <span id={labelId} className="sr-only">
        {ariaLabel}
      </span>
      <EditorContent editor={editor} />
    </div>
  );
}

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
