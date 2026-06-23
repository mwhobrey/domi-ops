"use client";

import { useEffect, type RefObject } from "react";

type Options = {
  /** CSS fallback when element is not mounted (SSR / before measure). */
  fallback?: string;
};

/**
 * Writes an element's border-box height to a CSS custom property on :root.
 * Used for calendar sticky chrome so week/day grid max-height tracks toolbar wrap.
 */
export function useMeasuredCssVar(
  ref: RefObject<HTMLElement | null>,
  varName: string,
  { fallback }: Options = {},
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const root = document.documentElement;

    function apply(height: number) {
      root.style.setProperty(varName, `${height}px`);
    }

    apply(el.getBoundingClientRect().height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      apply(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (fallback) {
        root.style.setProperty(varName, fallback);
      } else {
        root.style.removeProperty(varName);
      }
    };
  }, [ref, varName, fallback]);
}
