"use client";

import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./IconButton";

function promptForLink(existingHref?: string | null): string | null {
  const url = window.prompt("Link URL", existingHref ?? "https://");
  if (url === null) return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function MarkdownRichEditor({
  value,
  onChange,
  disabled,
  placeholder = "Write your note…",
  "aria-label": ariaLabel = "Note content",
  minHeightClass = "min-h-[6.5rem]",
}: {
  value: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  minHeightClass?: string;
}) {
  const labelId = useId();

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
      }),
      Markdown,
    ],
    content: value || "",
    contentType: "markdown",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getMarkdown());
    },
    editorProps: {
      attributes: {
        class: cn(
          "note-rich-editor__content markdown-content px-3 py-2.5 text-sm outline-none",
          minHeightClass,
        ),
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
    const current = editor.getMarkdown();
    if (current !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false, contentType: "markdown" });
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
    </div>
  );
}
