"use client";

import dynamic from "next/dynamic";

/**
 * react-markdown + remark-gfm are ~55 KB gzipped. Re-exported through the ui barrel, a static
 * import put them on every page (login included); this still server-renders but only loads the
 * renderer where markdown is actually shown.
 */
export const MarkdownContent = dynamic(() =>
  import("./MarkdownContent").then((m) => m.MarkdownContent),
);
