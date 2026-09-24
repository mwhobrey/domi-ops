"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "../../lib/format-datetime";

/**
 * Timestamp in the viewer's timezone. Formatted after mount: the server renders in UTC, so
 * formatting during SSR would show a different time than the browser and fail hydration.
 * `format` swaps the default "Sep 22, 5:23 PM" for another client-side formatter;
 * `refreshMs` re-runs it on a timer for text that depends on the clock ("· overdue").
 */
export function LocalDateTime({
  value,
  className,
  format = formatDateTime,
  refreshMs,
}: {
  value: string;
  className?: string;
  format?: (value: string) => string;
  refreshMs?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(format(value));
    if (!refreshMs) return;
    const id = window.setInterval(() => setText(format(value)), refreshMs);
    return () => window.clearInterval(id);
  }, [value, format, refreshMs]);
  return (
    <time dateTime={value} className={className}>
      {text ?? ""}
    </time>
  );
}
