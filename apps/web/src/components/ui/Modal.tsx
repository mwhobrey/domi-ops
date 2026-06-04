"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "../../lib/cn";
import { useLockBodyScroll } from "../../lib/use-lock-body-scroll";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  panelClassName,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  panelClassName?: string;
  bodyClassName?: string;
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
      className={cn("dialog-modal", className)}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      <div
        className="flex min-h-[100dvh] w-full items-center justify-center px-4 pb-6 pt-10 sm:px-6 sm:pb-8 sm:pt-14"
        onClick={() => onCloseRef.current()}
      >
        <div
          className={cn(
            "flex max-h-[min(88dvh,52rem)] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-elevated)]",
            panelClassName,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 border-b border-[var(--color-border)]/60 px-6 pb-6 pt-7">
            <h2 id={titleId} className="text-lg font-semibold leading-snug tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--color-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-7 pt-6",
              bodyClassName,
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className="shrink-0 border-t border-[var(--color-border)]/60">{footer}</div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
