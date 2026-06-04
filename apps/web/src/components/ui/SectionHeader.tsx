import { cn } from "../../lib/cn";

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <h2 className="text-label text-[var(--color-text-muted)]">{title}</h2>
      {action}
    </div>
  );
}
