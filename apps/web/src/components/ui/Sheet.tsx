"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "../../lib/cn";
import { useLockBodyScroll } from "../../lib/use-lock-body-scroll";
import { IconButton } from "./IconButton";

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;

    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();

    function requestClose() {
      onCloseRef.current();
    }

    function onCancel(e: Event) {
      e.preventDefault();
      requestClose();
    }

    dialog.addEventListener("cancel", onCancel);

    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        "dialog-sheet fixed inset-y-0 right-0 z-50 m-0 ml-auto flex h-full max-h-full w-full max-w-md flex-col border-0 border-l border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-0 shadow-[var(--shadow-elevated)] backdrop:bg-black/50",
        className,
      )}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      <div className="shrink-0 border-b border-[var(--color-border)]/60 px-6 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold leading-snug tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" className="shrink-0" onClick={() => onCloseRef.current()}>
            ✕
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </dialog>
  );
}
