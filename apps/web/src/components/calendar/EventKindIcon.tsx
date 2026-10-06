import { supplyChipKind } from "../../lib/calendar-utils";

/**
 * A small mark before a chip's title for the pill organizer and refill chips (WHO-431), so they read differently from
 * doses and checks even where only the title shows: a row of compartments for a fill, a bottle for a refill. Nothing for
 * any other event. It takes the text colour of the chip it sits in and is hidden from screen readers (the title says it).
 */
export function EventKindIcon({ event, className = "" }: { event: { id: string }; className?: string }) {
  const kind = supplyChipKind(event);
  if (!kind) return null;
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: `inline-block shrink-0 align-[-1px] ${className}`,
  };
  return kind === "appointment" ? (
    <svg {...common} data-kind="appointment">
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M5.8 4v8M10.2 4v8" />
    </svg>
  ) : (
    <svg {...common} data-kind="refill">
      <path d="M5 2.5h6M6 2.5v2M10 2.5v2" />
      <rect x="4" y="4.5" width="8" height="9" rx="1.5" />
      <path d="M8 7v3M6.5 8.5h3" />
    </svg>
  );
}
