import { cn } from "../../lib/cn";

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 text-[var(--color-text-muted)] opacity-60" aria-hidden>
          {icon}
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
