"use client";

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "../lib/cn";
import {
  DASHBOARD_CARD_LABELS,
  DASHBOARD_GRID_GAP_PX,
  spanFromResize,
  type DashboardCardId,
  type DashboardColumnCount,
  type DashboardSpan,
} from "../lib/dashboard-layout";

const COL_SPAN: Record<DashboardSpan, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
};

export function DashboardDragGhost({ id }: { id: DashboardCardId }) {
  return (
    <div className="inline-flex max-w-xs items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm font-medium shadow-[var(--shadow-elevated)] cursor-grabbing">
      <GripVertical className="h-5 w-5 text-[var(--color-text-muted)]" />
      {DASHBOARD_CARD_LABELS[id]}
    </div>
  );
}

export function DashboardSortableSection({
  id,
  span,
  columns,
  customizing,
  gridRef,
  onSpanChange,
  onSpanCommit,
  children,
}: {
  id: DashboardCardId;
  span: DashboardSpan;
  columns: DashboardColumnCount;
  customizing: boolean;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onSpanChange: (span: DashboardSpan) => void;
  onSpanCommit: () => void;
  children: React.ReactNode;
}) {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !customizing,
    animateLayoutChanges: () => false,
  });

  function setRefs(node: HTMLDivElement | null) {
    itemRef.current = node;
    setNodeRef(node);
  }

  function handleResizePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const grid = gridRef.current;
    const item = itemRef.current;
    if (!grid || !item) return;
    const next = spanFromResize(
      event.clientX,
      item.getBoundingClientRect().left,
      grid.getBoundingClientRect().width,
      columns,
      DASHBOARD_GRID_GAP_PX,
    );
    if (next !== span) onSpanChange(next);
  }

  function handleResizeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    let next: DashboardSpan | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = Math.max(1, span - 1) as DashboardSpan;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = Math.min(columns, span + 1) as DashboardSpan;
    }
    if (next == null) return;
    event.preventDefault();
    if (next === span) return;
    onSpanChange(next);
    onSpanCommit();
  }

  return (
    <div
      ref={setRefs}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn(COL_SPAN[span], isDragging && "opacity-40")}
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
        {customizing && columns > 1 ? (
          <button
            type="button"
            role="slider"
            aria-label={`Resize ${DASHBOARD_CARD_LABELS[id]}`}
            aria-valuemin={1}
            aria-valuemax={columns}
            aria-valuenow={span}
            className="absolute inset-y-2 right-0 z-10 hidden w-5 cursor-ew-resize touch-none items-center justify-center md:flex"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={onSpanCommit}
            onPointerCancel={onSpanCommit}
            onKeyDown={handleResizeKeyDown}
          >
            <span className="h-10 w-1 rounded-full bg-[var(--color-border)]" />
          </button>
        ) : null}
        <div className={customizing ? "pointer-events-none select-none" : undefined}>{children}</div>
      </div>
    </div>
  );
}
