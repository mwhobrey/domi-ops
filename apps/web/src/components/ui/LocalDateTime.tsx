"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "../../lib/format-datetime";

/**
 * Timestamp in the viewer's timezone. Formatted after mount: the server renders in UTC, so
 * formatting during SSR would show a different time than the browser and fail hydration.
 */
export function LocalDateTime({ value, className }: { value: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(formatDateTime(value));
  }, [value]);
  return (
    <time dateTime={value} className={className}>
      {text ?? ""}
    </time>
  );
}
