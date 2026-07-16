import Link from "next/link";
import { cn } from "../../lib/cn";

type Tone = "default" | "warning" | "success";

const toneClass: Record<Tone, string> = {
  default: "text-[var(--color-text)]",
  warning: "text-[var(--color-warning)]",
  success: "text-[var(--color-success)]",
};

export function StatTile({
  label,
  value,
  href,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: Tone;
  className?: string;
}) {
  const content = (
    <>
      <p className="text-label text-[var(--color-text-muted)]">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass[tone])}>{value}</p>
    </>
  );
  const classes = cn(
    "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 transition",
    href && "group hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-elevated)]",
    className,
  );

  if (!href) {
    return <div className={classes}>{content}</div>;
  }

  return (
    <Link
      href={href}
      className={classes}
    >
      {content}
    </Link>
  );
}
