import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const Textarea = forwardRef(function Textarea(
  {
    className,
    error,
    ...props
  }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string },
  ref: React.ForwardedRef<HTMLTextAreaElement>,
) {
  return (
    <div className="space-y-1">
      <textarea
        ref={ref}
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
});
