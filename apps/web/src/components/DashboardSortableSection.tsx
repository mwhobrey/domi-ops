"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "../lib/cn";
import { DASHBOARD_CARD_LABELS, type DashboardCardId } from "../lib/dashboard-layout";

export function DashboardSortableSection({
  id,
  span,
  customizing,
  children,
}: {
  id: DashboardCardId;
  span: "full" | "half";
  customizing: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !customizing,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn(span === "full" && "md:col-span-2", isDragging && "opacity-80")}
    >
      <div className="relative">
        {customizing ? (
          <button
            type="button"
            className="absolute left-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] shadow-[var(--shadow-card)] cursor-grab active:cursor-grabbing touch-none"
            aria-label={`Drag to reorder ${DASHBOARD_CARD_LABELS[id]}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5" />
          </button>
        ) : null}
        <div className={customizing ? "pointer-events-none select-none" : undefined}>{children}</div>
      </div>
    </div>
  );
}
