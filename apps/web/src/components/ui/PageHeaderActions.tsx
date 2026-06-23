"use client";

import { EllipsisVertical } from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

export function PageHeaderActions({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  if (items.length === 0) return null;

  if (items.length === 1) {
    return <div className="flex flex-wrap items-center gap-2">{items[0]}</div>;
  }

  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 md:flex">{children}</div>
      <div className="relative md:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Page actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <EllipsisVertical className="h-5 w-5" aria-hidden />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            className="absolute right-0 z-20 mt-2 min-w-[10rem] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1 shadow-[var(--shadow-elevated)]"
          >
            {items.map((child, i) => {
              if (!isValidElement(child)) {
                return (
                  <div key={i} role="menuitem" className="px-3 py-2 text-sm">
                    {child}
                  </div>
                );
              }
              const el = child as ReactElement<{
                className?: string;
                onClick?: (...args: unknown[]) => void;
                role?: string;
              }>;
              return cloneElement(el, {
                key: i,
                role: "menuitem",
                className: cn(
                  "flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-sm hover:bg-[var(--color-border)]/40",
                  el.props.className,
                ),
                onClick: (...args: unknown[]) => {
                  el.props.onClick?.(...args);
                  closeMenu();
                },
              });
            })}
          </div>
        )}
      </div>
    </>
  );
}
