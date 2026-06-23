"use client";

import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import { useLockBodyScroll } from "../../lib/use-lock-body-scroll";
import { IconButton } from "./IconButton";

export function Drawer({
  open,
  onClose,
  title,
  children,
  className,
  footer,
  visibility = "mobile",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  /** mobile: left sheet below lg (hamburger). desktop: left sheet lg+ only (modules menu). */
  visibility?: "mobile" | "desktop";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;

    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();

    requestAnimationFrame(() => {
      const focusable = dialog.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });

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
      aria-label={title}
      className={cn(
        "dialog-drawer fixed inset-y-0 left-0 z-50 m-0 flex h-full max-h-full flex-col border-0 border-r border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-0 backdrop:bg-black/60",
        visibility === "desktop"
          ? "hidden w-80 lg:flex"
          : "w-72 lg:hidden",
        className,
      )}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <span className="font-semibold">{title}</span>
        <IconButton label="Close menu" onClick={() => onCloseRef.current()}>
          ✕
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && <div className="border-t border-[var(--color-border)] p-4">{footer}</div>}
    </dialog>
  );
}
