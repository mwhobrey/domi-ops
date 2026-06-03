import { cn } from "../../lib/cn";

export function Select({
  className,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <div className="space-y-1">
      <select
        className={cn(
          "w-full rounded-[var(--radius-lg)] border bg-[var(--color-surface-elevated)] px-3 py-2 text-sm",
          error ? "border-[var(--color-danger)]" : "border-[var(--color-border)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
