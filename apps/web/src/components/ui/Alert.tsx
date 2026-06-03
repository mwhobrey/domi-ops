import { cn } from "../../lib/cn";

type Variant = "info" | "success" | "error";

const styles: Record<Variant, string> = {
  info: "border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)]",
  success: "border-[var(--color-success-muted)] bg-[var(--color-success-muted)]/20 text-[var(--color-success)]",
  error: "border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 text-[var(--color-danger)]",
};

export function Alert({
  variant = "info",
  children,
  className,
}: {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border px-4 py-3 text-sm",
        styles[variant],
        className,
      )}
      role="alert"
    >
      {children}
    </div>
  );
}
