"use client";

import { Button, Sheet } from "../ui";

export type RecurringScope = "this" | "series";

export function RecurringScopeSheet({
  open,
  title,
  onChoose,
  onCancel,
}: {
  open: boolean;
  title: string;
  onChoose: (scope: RecurringScope) => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} onClose={onCancel} title="Recurring event">
      <div className="space-y-4 p-5">
        <p className="text-sm text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text)]">{title}</span> is part of a
          repeating series. What should change?
        </p>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="primary" onClick={() => onChoose("this")}>
            This occurrence only
          </Button>
          <Button type="button" variant="secondary" onClick={() => onChoose("series")}>
            Entire series (future materialized dates)
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
