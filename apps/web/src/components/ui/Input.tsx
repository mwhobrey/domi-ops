import { cn } from "../../lib/cn";

export function Input({
  className,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <div className="space-y-1">
      <input
        className={cn(
          "w-full rounded-[var(--radius-lg)] border bg-transparent px-3 py-2 text-sm",
          error
            ? "border-[var(--color-danger)]"
            : "border-[var(--color-border)] focus:border-[var(--color-accent)]",
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
