import { cn } from "../../lib/cn";

export function Checkbox({
  label,
  className,
  error,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
  error?: string;
}) {
  const inputId = id ?? (typeof label === "string" ? label : undefined);
  const inputClass = cn(
    "h-4 w-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-accent)]",
    className,
  );

  if (!label) {
    return <input type="checkbox" id={inputId} className={inputClass} {...props} />;
  }

  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 text-sm" htmlFor={inputId}>
        <input type="checkbox" id={inputId} className={inputClass} {...props} />
        <span>{label}</span>
      </label>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
