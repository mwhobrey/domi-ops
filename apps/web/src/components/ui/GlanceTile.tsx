import Link from "next/link";
import { cn } from "../../lib/cn";

type Tone = "default" | "warning" | "success";

const toneClass: Record<Tone, string> = {
  default: "text-[var(--color-text)]",
  warning: "text-[var(--color-warning)]",
  success: "text-[var(--color-success)]",
};

export type GlancePreviewItem = {
  key: string;
  label: string;
  meta?: string;
  href?: string;
};

export function GlanceTile({
  label,
  headline,
  href,
  tone = "default",
  items,
  overflowCount = 0,
  emptyHint,
  className,
}: {
  label: string;
  headline: string;
  href: string;
  tone?: Tone;
  items: GlancePreviewItem[];
  overflowCount?: number;
  emptyHint?: string;
  className?: string;
}) {
  const showList = items.length > 0;

  return (
    <div
      className={cn(
        "group relative flex h-full min-h-[7rem] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-elevated)]",
        className,
      )}
    >
      <Link href={href} className="absolute inset-0 rounded-[var(--radius-lg)]" aria-label={`Open ${label}`} />
      <div className="pointer-events-none relative z-10 flex h-full flex-col">
        <p className="text-label text-[var(--color-text-muted)]">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass[tone])}>{headline}</p>
      {showList ? (
        <ul className="mt-3 flex-1 space-y-1.5 border-t border-[var(--color-border)]/60 pt-3">
          {items.slice(0, 3).map((item) => (
            <li key={item.key} className="min-w-0 text-sm">
              {item.href ? (
                <Link
                  href={item.href}
                  className="pointer-events-auto block truncate rounded-[var(--radius-sm)] font-medium text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
                  title={item.label}
                >
                  {item.label}
                </Link>
              ) : (
                <span className="block truncate font-medium" title={item.label}>
                  {item.label}
                </span>
              )}
              {item.meta ? (
                <span className="text-xs text-[var(--color-text-muted)]">{item.meta}</span>
              ) : null}
            </li>
          ))}
          {overflowCount > 0 ? (
            <li className="text-xs font-medium text-[var(--color-accent)]">+{overflowCount} more</li>
          ) : null}
        </ul>
      ) : emptyHint ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{emptyHint}</p>
      ) : null}
      </div>
    </div>
  );
}
