"use client";

import { useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui";
import { nextPainDraftKey, painSeverityColor } from "./health-helpers";
import {
  PAIN_BODY_REGION_LABELS,
  type HealthPainBodyRegion,
  type PainLogDraft,
} from "./health-types";

type RegionShape =
  | { region: HealthPainBodyRegion; shape: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { region: HealthPainBodyRegion; shape: "rect"; x: number; y: number; w: number; h: number; rx: number };

// viewBox 0 0 200 320. Front view mirrors left/right (person facing the viewer); back view
// doesn't (person facing away — their left stays on the image's left). Shoulders, upper arms,
// forearms, hands, and feet are the same clickable region on both views (see health-types.ts).
const FRONT_REGIONS: RegionShape[] = [
  { region: "front_head", shape: "ellipse", cx: 100, cy: 16, rx: 13, ry: 9 },
  { region: "face", shape: "ellipse", cx: 100, cy: 32, rx: 12, ry: 11 },
  { region: "neck_front", shape: "rect", x: 92, y: 41, w: 16, h: 9, rx: 3 },
  { region: "right_chest", shape: "rect", x: 70, y: 50, w: 29, h: 40, rx: 10 },
  { region: "left_chest", shape: "rect", x: 101, y: 50, w: 29, h: 40, rx: 10 },
  { region: "abdomen", shape: "rect", x: 75, y: 90, w: 50, h: 32, rx: 8 },
  { region: "groin", shape: "rect", x: 85, y: 122, w: 30, h: 15, rx: 6 },
  { region: "right_shoulder", shape: "ellipse", cx: 58, cy: 56, rx: 12, ry: 9 },
  { region: "left_shoulder", shape: "ellipse", cx: 142, cy: 56, rx: 12, ry: 9 },
  { region: "right_upper_arm", shape: "rect", x: 48, y: 63, w: 17, h: 46, rx: 8 },
  { region: "left_upper_arm", shape: "rect", x: 135, y: 63, w: 17, h: 46, rx: 8 },
  { region: "right_forearm", shape: "rect", x: 46, y: 111, w: 15, h: 42, rx: 7 },
  { region: "left_forearm", shape: "rect", x: 139, y: 111, w: 15, h: 42, rx: 7 },
  { region: "right_hand", shape: "ellipse", cx: 53, cy: 162, rx: 9, ry: 11 },
  { region: "left_hand", shape: "ellipse", cx: 147, cy: 162, rx: 9, ry: 11 },
  { region: "right_thigh", shape: "rect", x: 76, y: 137, w: 21, h: 60, rx: 9 },
  { region: "left_thigh", shape: "rect", x: 103, y: 137, w: 21, h: 60, rx: 9 },
  { region: "right_shin", shape: "rect", x: 78, y: 199, w: 17, h: 55, rx: 8 },
  { region: "left_shin", shape: "rect", x: 105, y: 199, w: 17, h: 55, rx: 8 },
  { region: "right_foot", shape: "ellipse", cx: 87, cy: 264, rx: 13, ry: 8 },
  { region: "left_foot", shape: "ellipse", cx: 113, cy: 264, rx: 13, ry: 8 },
];

const BACK_REGIONS: RegionShape[] = [
  { region: "back_head", shape: "ellipse", cx: 100, cy: 16, rx: 13, ry: 9 },
  { region: "neck_back", shape: "rect", x: 92, y: 25, w: 16, h: 12, rx: 3 },
  { region: "left_shoulder", shape: "ellipse", cx: 58, cy: 56, rx: 12, ry: 9 },
  { region: "right_shoulder", shape: "ellipse", cx: 142, cy: 56, rx: 12, ry: 9 },
  { region: "left_shoulder_blade", shape: "rect", x: 66, y: 50, w: 24, h: 30, rx: 8 },
  { region: "right_shoulder_blade", shape: "rect", x: 110, y: 50, w: 24, h: 30, rx: 8 },
  { region: "upper_back", shape: "rect", x: 78, y: 82, w: 44, h: 26, rx: 8 },
  { region: "lower_back", shape: "rect", x: 80, y: 110, w: 40, h: 22, rx: 8 },
  // Drawn after upper/lower back so it sits on top of them; they stay tappable on either side.
  { region: "spine", shape: "rect", x: 92, y: 38, w: 16, h: 94, rx: 6 },
  { region: "left_upper_arm", shape: "rect", x: 48, y: 63, w: 17, h: 46, rx: 8 },
  { region: "right_upper_arm", shape: "rect", x: 135, y: 63, w: 17, h: 46, rx: 8 },
  { region: "left_forearm", shape: "rect", x: 46, y: 111, w: 15, h: 42, rx: 7 },
  { region: "right_forearm", shape: "rect", x: 139, y: 111, w: 15, h: 42, rx: 7 },
  { region: "left_hand", shape: "ellipse", cx: 53, cy: 162, rx: 9, ry: 11 },
  { region: "right_hand", shape: "ellipse", cx: 147, cy: 162, rx: 9, ry: 11 },
  { region: "buttocks", shape: "rect", x: 80, y: 134, w: 40, h: 24, rx: 10 },
  { region: "left_hamstring", shape: "rect", x: 76, y: 160, w: 21, h: 58, rx: 9 },
  { region: "right_hamstring", shape: "rect", x: 103, y: 160, w: 21, h: 58, rx: 9 },
  { region: "left_calf", shape: "rect", x: 78, y: 220, w: 17, h: 50, rx: 8 },
  { region: "right_calf", shape: "rect", x: 105, y: 220, w: 17, h: 50, rx: 8 },
  { region: "left_foot", shape: "ellipse", cx: 87, cy: 264, rx: 13, ry: 8 },
  { region: "right_foot", shape: "ellipse", cx: 113, cy: 264, rx: 13, ry: 8 },
];

function RegionPath({
  shape,
  severity,
  disabled,
  onClick,
}: {
  shape: RegionShape;
  severity: number | undefined;
  disabled?: boolean;
  onClick: () => void;
}) {
  const fill = severity ? painSeverityColor(severity) : "var(--color-surface-elevated)";
  const fillOpacity = severity ? 0.75 : 1;
  const common = {
    fill,
    fillOpacity,
    stroke: "var(--color-border)",
    strokeWidth: 1,
    className: disabled
      ? "cursor-default"
      : "cursor-pointer transition-colors hover:stroke-[var(--color-accent)]",
    onClick: disabled ? undefined : onClick,
    role: "button" as const,
    tabIndex: disabled ? -1 : 0,
    "aria-disabled": disabled || undefined,
    "aria-label": `${PAIN_BODY_REGION_LABELS[shape.region]}${severity ? `, severity ${severity} of 10` : ""}`,
    onKeyDown: disabled
      ? undefined
      : (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
  };
  if (shape.shape === "ellipse") {
    return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
  }
  return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...common} />;
}

/**
 * Tappable front/back body map for pain logging (WHO-298). Tapping a region adds a draft row
 * with a default severity; the severity list below the diagram is where the number actually
 * gets set/edited — same "diagram picks the spot, list edits the value" split as the vitals
 * multi-reading sheet, just region-driven instead of metric-driven.
 */
export function BodyPainMap({
  entries,
  onChange,
  disabled = false,
}: {
  entries: PainLogDraft[];
  onChange: (entries: PainLogDraft[]) => void;
  disabled?: boolean;
}) {
  const [view, setView] = useState<"front" | "back">("front");
  const regions = view === "front" ? FRONT_REGIONS : BACK_REGIONS;
  const severityByRegion = new Map(entries.map((e) => [e.region, e.severity]));

  function toggleRegion(region: HealthPainBodyRegion) {
    if (disabled) return;
    const existing = entries.find((e) => e.region === region);
    if (existing) {
      onChange(entries.filter((e) => e.key !== existing.key));
      return;
    }
    onChange([...entries, { key: nextPainDraftKey(), region, severity: 5 }]);
  }

  function updateSeverity(key: string, severity: number) {
    if (disabled) return;
    onChange(entries.map((e) => (e.key === key ? { ...e, severity } : e)));
  }

  function removeEntry(key: string) {
    if (disabled) return;
    onChange(entries.filter((e) => e.key !== key));
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={view === "front" ? "primary" : "secondary"}
          aria-pressed={view === "front"}
          onClick={() => setView("front")}
        >
          Front
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "back" ? "primary" : "secondary"}
          aria-pressed={view === "back"}
          onClick={() => setView("back")}
        >
          Back
        </Button>
      </div>
      <svg viewBox="0 0 200 280" className="mx-auto h-72 w-auto">
        {regions.map((shape) => (
          <RegionPath
            key={`${view}-${shape.region}`}
            shape={shape}
            severity={severityByRegion.get(shape.region)}
            disabled={disabled}
            onClick={() => toggleRegion(shape.region)}
          />
        ))}
      </svg>
      {entries.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Tap a region to log pain there.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: painSeverityColor(entry.severity) }}
                aria-hidden
              />
              <span className="flex-1 text-sm">{PAIN_BODY_REGION_LABELS[entry.region]}</span>
              <input
                type="range"
                min={1}
                max={10}
                value={entry.severity}
                disabled={disabled}
                onChange={(e) => updateSeverity(entry.key, Number(e.target.value))}
                aria-label={`${PAIN_BODY_REGION_LABELS[entry.region]} severity`}
                className="w-28 disabled:opacity-50"
              />
              <span className="w-6 shrink-0 text-right text-sm tabular-nums">{entry.severity}</span>
              <button
                type="button"
                onClick={() => removeEntry(entry.key)}
                disabled={disabled}
                aria-label={`Remove ${PAIN_BODY_REGION_LABELS[entry.region]}`}
                className={cn(
                  "shrink-0 rounded-full p-1 text-[var(--color-text-muted)]",
                  "hover:bg-[var(--color-border)]/50 hover:text-[var(--color-text)]",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
