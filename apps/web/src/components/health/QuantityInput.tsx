"use client";

import { Button, Input } from "../ui";
import { formatPills, parseQuantityInput, stepQuantity } from "./organizer-helpers";

/**
 * A pill count you can type the way you say it ("1½", "3/4", "1 1/2", "0.25") or nudge a quarter at a time (WHO-427).
 * What is typed stays as typed until it is saved; the parent decides what to do with an invalid value.
 */
export function QuantityInput({
  value,
  onChange,
  label,
  invalid = false,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** What the field is for, read out to people who cannot see the row it sits in. */
  label: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const current = (() => {
    const parsed = parseQuantityInput(value);
    return parsed.ok ? parsed.pills : null;
  })();
  const nudge = (direction: 1 | -1) => {
    const next = stepQuantity(current, direction);
    onChange(next === null ? "" : formatPills(next));
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" size="sm" variant="secondary" aria-label={`One quarter fewer, ${label}`} disabled={disabled || current === null} onClick={() => nudge(-1)}>
        −
      </Button>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`w-20 text-center ${invalid ? "border-[var(--color-danger)]" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="pills"
        maxLength={8}
        aria-label={`Pills, ${label}`}
        aria-invalid={invalid}
        disabled={disabled}
      />
      <Button type="button" size="sm" variant="secondary" aria-label={`One quarter more, ${label}`} disabled={disabled} onClick={() => nudge(1)}>
        +
      </Button>
    </div>
  );
}
