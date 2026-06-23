"use client";

import { Button, SectionHeader } from "../ui";

export function ReportSection({
  title,
  onExport,
  exportDisabled,
  children,
  actions,
}: {
  title: string;
  onExport?: () => void;
  exportDisabled?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader
          title={title}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              {onExport ? (
                <Button type="button" size="sm" onClick={onExport} disabled={exportDisabled}>
                  Export…
                </Button>
              ) : null}
            </div>
          }
        />
      </div>
      {children}
    </section>
  );
}
