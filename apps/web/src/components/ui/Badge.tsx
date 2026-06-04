import { cn } from "../../lib/cn";

type Tone = "default" | "success" | "warning" | "accent";

const toneClass: Record<Tone, string> = {
  default: "bg-[var(--color-border)]/50 text-[var(--color-text-muted)]",
  success: "bg-[var(--color-success-muted)]/40 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-muted)]/40 text-[var(--color-warning)]",
  accent: "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
