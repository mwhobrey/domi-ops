import { cn } from "../../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-[var(--radius-md)] bg-[var(--color-border)]/50",
        className,
      )}
    />
  );
}
