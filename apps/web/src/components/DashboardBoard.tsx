"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { LayoutGrid } from "lucide-react";
import { apiClient } from "../lib/client-api";
import { cn } from "../lib/cn";
import {
  applyVisibleReorder,
  availableDashboardCards,
  DASHBOARD_COLUMN_COUNTS,
  hydrateDashboardLayout,
  resolveDashboardSpan,
  visibleDashboardLayout,
  type DashboardCardId,
  type DashboardColumnCount,
  type DashboardLayoutSaved,
  type DashboardLayoutState,
  type DashboardSpan,
} from "../lib/dashboard-layout";
import { DashboardMonthCalendar } from "./DashboardMonthCalendar";
import { DashboardDragGhost, DashboardSortableSection } from "./DashboardSortableSection";
import { HouseholdPanel, type SelfStatus, type StatusRow } from "./HouseholdPanel";
import { OnboardingChecklist, type OnboardingState } from "./OnboardingChecklist";
import { ScheduleConflictChecker } from "./ScheduleConflictChecker";
import { TodayAgenda } from "./TodayAgenda";
import { TodayGlance } from "./TodayGlance";
import { WeatherPanel } from "./WeatherPanel";
import { Button, PageHeader } from "./ui";

let persistChain: Promise<unknown> = Promise.resolve();

function persist(layout: DashboardLayoutState | null) {
  persistChain = persistChain
    .then(() =>
      apiClient.patch(
        "/api/core/dashboard-layout",
        layout
          ? { cards: layout.cards, columns: layout.columns, spans: layout.spans }
          : { cards: null },
      ),
    )
    .catch(() => {
      /* best-effort — next load falls back to the last successful save */
    });
}

const GRID_COLS: Record<DashboardColumnCount, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

export function DashboardBoard({
  whosHome,
  self,
  schoolModuleEnabled = false,
  healthModuleEnabled = false,
  driveModuleEnabled = false,
  calendarModuleEnabled = false,
  goalsModuleEnabled = false,
  role = null,
  onboarding = null,
  glanceConfig = null,
  initialLayout = null,
}: {
  whosHome: StatusRow[];
  self: SelfStatus | null;
  schoolModuleEnabled?: boolean;
  healthModuleEnabled?: boolean;
  driveModuleEnabled?: boolean;
  calendarModuleEnabled?: boolean;
  goalsModuleEnabled?: boolean;
  role?: string | null;
  onboarding?: OnboardingState | null;
  glanceConfig?: string[] | null;
  initialLayout?: DashboardLayoutSaved | string[] | null;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [activeId, setActiveId] = useState<DashboardCardId | null>(null);
  const [layout, setLayout] = useState<DashboardLayoutState>(() => hydrateDashboardLayout(initialLayout));
  const customized = initialLayout != null && (Array.isArray(initialLayout) || initialLayout.cards != null);
  const [dirty, setDirty] = useState(customized);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const available = useMemo(
    () => availableDashboardCards({ calendarModuleEnabled }),
    [calendarModuleEnabled],
  );
  const visible = useMemo(
    () => visibleDashboardLayout(layout.cards, available),
    [layout.cards, available],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function save(next: DashboardLayoutState) {
    setDirty(true);
    setLayout(next);
    persist(next);
  }

  function handleDragStart(event: DragStartEvent) {
    if (!customizing) return;
    setActiveId(event.active.id as DashboardCardId);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!customizing) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visible.indexOf(active.id as DashboardCardId);
    const newIndex = visible.indexOf(over.id as DashboardCardId);
    if (oldIndex < 0 || newIndex < 0) return;
    save({
      ...layout,
      cards: applyVisibleReorder(layout.cards, arrayMove(visible, oldIndex, newIndex)),
    });
  }

  function reset() {
    const next = hydrateDashboardLayout(null);
    setLayout(next);
    setDirty(false);
    persist(null);
  }

  function renderCard(id: DashboardCardId) {
    switch (id) {
      case "glance":
        return (
          <TodayGlance
            schoolModuleEnabled={schoolModuleEnabled}
            healthModuleEnabled={healthModuleEnabled}
            driveModuleEnabled={driveModuleEnabled}
            calendarModuleEnabled={calendarModuleEnabled}
            goalsModuleEnabled={goalsModuleEnabled}
            glanceConfig={glanceConfig}
          />
        );
      case "agenda":
        return <TodayAgenda />;
      case "weather":
        return <WeatherPanel compact />;
      case "conflicts":
        return <ScheduleConflictChecker healthModuleEnabled={healthModuleEnabled} />;
      case "household":
        return <HouseholdPanel initial={whosHome} self={self} />;
      case "month":
        return <DashboardMonthCalendar compact />;
    }
  }

  return (
    <div>
      {role ? (
        <div className="mb-6 empty:hidden">
          <OnboardingChecklist role={role} initialState={onboarding} />
        </div>
      ) : null}
      <PageHeader
        title="Dashboard"
        description={
          customizing
            ? "Drag handles to reorder. The right edge resizes a card across columns. Saved for you, not the whole household."
            : undefined
        }
        descriptionVisibility={customizing ? "always" : "never"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {customizing ? (
              <div
                className="inline-flex overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
                role="group"
                aria-label="Dashboard columns"
              >
                {DASHBOARD_COLUMN_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={layout.columns === count}
                    className={cn(
                      "min-w-11 px-3 py-1.5 text-xs",
                      layout.columns === count
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-[var(--color-surface-elevated)] text-[var(--color-text)] hover:bg-[var(--color-border)]/40",
                    )}
                    onClick={() => save({ ...layout, columns: count })}
                  >
                    {count}
                  </button>
                ))}
              </div>
            ) : null}
            {customizing && dirty ? (
              <Button variant="ghost" size="sm" onClick={reset}>
                Reset to default
              </Button>
            ) : null}
            <Button
              variant={customizing ? "primary" : "secondary"}
              size="sm"
              onClick={() => setCustomizing((v) => !v)}
              aria-pressed={customizing}
            >
              <LayoutGrid className="h-4 w-4" />
              {customizing ? "Done" : "Customize"}
            </Button>
          </div>
        }
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          <div ref={gridRef} className={cn("grid gap-6 grid-cols-1", GRID_COLS[layout.columns])}>
            {visible.map((id) => (
              <DashboardSortableSection
                key={id}
                id={id}
                span={resolveDashboardSpan(id, layout.columns, layout.spans)}
                columns={layout.columns}
                customizing={customizing}
                gridRef={gridRef}
                onSpanChange={(span: DashboardSpan) => {
                  setDirty(true);
                  const current = layoutRef.current;
                  const next = {
                    ...current,
                    spans: { ...current.spans, [id]: span },
                  };
                  layoutRef.current = next;
                  setLayout(next);
                }}
                onSpanCommit={() => persist(layoutRef.current)}
              >
                {renderCard(id)}
              </DashboardSortableSection>
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null} adjustScale={false}>
          {activeId ? <DashboardDragGhost id={activeId} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
