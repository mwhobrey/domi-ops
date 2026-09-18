"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { LayoutGrid } from "lucide-react";
import { apiClient } from "../lib/client-api";
import {
  applyVisibleReorder,
  availableDashboardCards,
  dashboardCardSpan,
  hydrateDashboardLayout,
  visibleDashboardLayout,
  type DashboardCardId,
} from "../lib/dashboard-layout";
import { DashboardMonthCalendar } from "./DashboardMonthCalendar";
import { DashboardSortableSection } from "./DashboardSortableSection";
import { HouseholdPanel, type SelfStatus, type StatusRow } from "./HouseholdPanel";
import { OnboardingChecklist, type OnboardingState } from "./OnboardingChecklist";
import { ScheduleConflictChecker } from "./ScheduleConflictChecker";
import { TodayAgenda } from "./TodayAgenda";
import { TodayGlance } from "./TodayGlance";
import { WeatherPanel } from "./WeatherPanel";
import { Button } from "./ui";

function persist(cards: DashboardCardId[] | null) {
  apiClient.patch("/api/core/dashboard-layout", { cards }).catch(() => {
    /* best-effort — next load falls back to the last successful save */
  });
}

export function DashboardBoard({
  whosHome,
  self,
  schoolModuleEnabled = false,
  healthModuleEnabled = false,
  driveModuleEnabled = false,
  calendarModuleEnabled = false,
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
  role?: string | null;
  onboarding?: OnboardingState | null;
  glanceConfig?: string[] | null;
  initialLayout?: string[] | null;
}) {
  const [customizing, setCustomizing] = useState(false);
  const [customized, setCustomized] = useState(initialLayout !== null);
  const [fullOrder, setFullOrder] = useState<DashboardCardId[]>(() => hydrateDashboardLayout(initialLayout));

  const available = useMemo(
    () => availableDashboardCards({ calendarModuleEnabled }),
    [calendarModuleEnabled],
  );
  const visible = useMemo(() => visibleDashboardLayout(fullOrder, available), [fullOrder, available]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function save(nextFull: DashboardCardId[]) {
    setCustomized(true);
    setFullOrder(nextFull);
    persist(nextFull);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!customizing) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visible.indexOf(active.id as DashboardCardId);
    const newIndex = visible.indexOf(over.id as DashboardCardId);
    if (oldIndex < 0 || newIndex < 0) return;
    save(applyVisibleReorder(fullOrder, arrayMove(visible, oldIndex, newIndex)));
  }

  function reset() {
    const next = hydrateDashboardLayout(null);
    setFullOrder(next);
    setCustomized(false);
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

  const grid = (
    <div className="grid gap-6 md:grid-cols-2 md:items-stretch">
      {visible.map((id) => (
        <DashboardSortableSection
          key={id}
          id={id}
          span={dashboardCardSpan(id, visible)}
          customizing={customizing}
        >
          {renderCard(id)}
        </DashboardSortableSection>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {role && <OnboardingChecklist role={role} initialState={onboarding} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {customizing && customized ? (
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
      {customizing ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Drag the handles to put these cards in the order you actually look at first. Saved for
          you, not the whole household.
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          {grid}
        </SortableContext>
      </DndContext>
    </div>
  );
}
