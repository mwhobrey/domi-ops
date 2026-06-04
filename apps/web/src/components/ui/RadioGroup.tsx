import { cn } from "../../lib/cn";

export function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
  className,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: React.ReactNode; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="text-sm font-medium">{legend}</legend>
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            disabled={opt.disabled}
            className="h-4 w-4 accent-[var(--color-accent)]"
            onChange={() => onChange(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
}
