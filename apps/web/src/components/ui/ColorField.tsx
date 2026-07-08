"use client";



import { useCallback, useEffect, useId, useRef, useState } from "react";

import { HexColorPicker } from "react-colorful";

import { cn } from "../../lib/cn";

import { CALENDAR_COLOR_PRESETS, normalizeHexColor } from "../../lib/calendar-color-presets";

import { useEscapeKey } from "../../lib/use-escape-key";

import { Button } from "./Button";

import { Input } from "./Input";



const POPOVER_GAP = 8;

const POPOVER_WIDTH = 248;



function pickerHex(value: string, fallback = "#3b82f6"): string {

  return normalizeHexColor(value) ?? fallback;

}



function PresetSwatches({

  presets,

  safeValue,

  disabled,

  ariaLabel,

  listId,

  size,

  onSelect,

}: {

  presets: readonly string[];

  safeValue: string;

  disabled?: boolean;

  ariaLabel: string;

  listId: string;

  size: "popover" | "inline";

  onSelect: (hex: string) => void;

}) {

  return (

    <div

      role="listbox"

      aria-label={`${ariaLabel} presets`}

      aria-labelledby={listId}

      className={cn(

        "flex flex-wrap gap-1.5",

        size === "inline" &&

          "rounded-[var(--radius-lg)] border border-[var(--color-border)]/80 bg-[var(--color-surface-muted)]/35 p-2 gap-2",

        size === "popover" && "mt-2 border-t border-[var(--color-border)]/60 pt-2",

      )}

    >

      <span id={listId} className="sr-only">

        {ariaLabel}

      </span>

      {presets.map((hex) => {

        const selected = safeValue.toLowerCase() === hex.toLowerCase();

        return (

          <button

            key={hex}

            type="button"

            role="option"

            aria-selected={selected}

            aria-label={hex}

            disabled={disabled}

            className={cn(

              "relative shrink-0 rounded-full border-2 shadow-sm transition-[transform,box-shadow] duration-150",

              "hover:scale-110 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-elevated)]",

              size === "inline" ? "h-9 w-9" : "h-7 w-7",

              selected

                ? "scale-105 border-[var(--color-text)] ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface-elevated)]"

                : "border-[var(--color-border)]/90",

              disabled && "pointer-events-none opacity-45",

            )}

            style={{ backgroundColor: hex }}

            onClick={() => onSelect(hex)}

          >

            {selected && (

              <span

                className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"

                aria-hidden

              >

                ✓

              </span>

            )}

          </button>

        );

      })}

    </div>

  );

}



export function ColorField({

  value,

  onChange,

  disabled,

  compact,

  inlinePresets = false,

  presets = CALENDAR_COLOR_PRESETS,

  ariaLabel = "Event color",

}: {

  value: string;

  onChange: (hex: string) => void;

  disabled?: boolean;

  compact?: boolean;

  /** Show preset swatches above the hex row (default: presets live in the spectrum popover). */

  inlinePresets?: boolean;

  presets?: readonly string[];

  ariaLabel?: string;

}) {

  const listId = useId();

  const popoverId = useId();

  const safeValue = pickerHex(value);

  const [hexDraft, setHexDraft] = useState(safeValue.replace(/^#/, ""));

  const [hexError, setHexError] = useState<string | undefined>();

  const [popoverOpen, setPopoverOpen] = useState(false);

  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const swatchRef = useRef<HTMLButtonElement>(null);

  const popoverRef = useRef<HTMLDivElement>(null);

  const ignoreOutsideRef = useRef(false);



  useEffect(() => {

    const next = pickerHex(value);

    setHexDraft(next.replace(/^#/, ""));

    setHexError(undefined);

  }, [value]);



  const closePopover = useCallback(() => setPopoverOpen(false), []);



  useEscapeKey(closePopover, popoverOpen);



  const updatePopoverPosition = useCallback(() => {

    const el = swatchRef.current;

    if (!el) return;

    const rect = el.getBoundingClientRect();

    let left = rect.left;

    const maxLeft = window.innerWidth - POPOVER_WIDTH - 12;

    if (left > maxLeft) left = Math.max(12, maxLeft);

    const estimatedHeight = compact ? 300 : 320;

    let top = rect.bottom + POPOVER_GAP;

    if (top + estimatedHeight > window.innerHeight - 12) {

      top = Math.max(12, rect.top - estimatedHeight - POPOVER_GAP);

    }

    setPopoverPos({ top, left });

  }, [compact]);



  const openPopover = useCallback(() => {

    ignoreOutsideRef.current = true;

    updatePopoverPosition();

    setPopoverOpen(true);

    requestAnimationFrame(() => {

      ignoreOutsideRef.current = false;

    });

  }, [updatePopoverPosition]);



  useEffect(() => {
    if (!popoverOpen) return;

    updatePopoverPosition();

    function onResize() {
      updatePopoverPosition();
    }

    function onScroll() {
      closePopover();
    }

    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [popoverOpen, updatePopoverPosition, closePopover]);



  useEffect(() => {

    if (!popoverOpen) return;

    function onPointerDown(e: PointerEvent) {

      if (ignoreOutsideRef.current) return;

      const target = e.target as Node;

      if (popoverRef.current?.contains(target) || swatchRef.current?.contains(target)) {

        return;

      }

      closePopover();

    }

    document.addEventListener("pointerdown", onPointerDown, true);

    return () => document.removeEventListener("pointerdown", onPointerDown, true);

  }, [popoverOpen, closePopover]);



  function commitHex(raw: string) {

    const normalized = normalizeHexColor(raw.startsWith("#") ? raw : `#${raw}`);

    if (normalized) {

      onChange(normalized);

      setHexDraft(normalized.replace(/^#/, ""));

      setHexError(undefined);

      return true;

    }

    setHexError("Use 6-digit hex, e.g. 3b82f6");

    return false;

  }



  function selectPreset(hex: string) {

    onChange(hex);

    closePopover();

  }



  function selectFromWheel(hex: string) {

    const normalized = normalizeHexColor(hex);

    if (normalized) onChange(normalized);

  }



  function togglePopover() {

    if (disabled) return;

    if (popoverOpen) {

      closePopover();

      return;

    }

    openPopover();

  }



  return (

    <div className={cn(inlinePresets && "space-y-2.5")}>

      {inlinePresets && (

        <PresetSwatches

          presets={presets}

          safeValue={safeValue}

          disabled={disabled}

          ariaLabel={ariaLabel}

          listId={listId}

          size="inline"

          onSelect={selectPreset}

        />

      )}



      <div className="relative flex items-center gap-3">

        <button

          ref={swatchRef}

          type="button"

          disabled={disabled}

          aria-expanded={popoverOpen}

          aria-controls={popoverOpen ? popoverId : undefined}

          aria-haspopup="dialog"

          aria-label={`${ariaLabel} — open color picker`}

          title="Pick color"

          className={cn(

            "shrink-0 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] transition-shadow",

            "hover:ring-2 hover:ring-[var(--color-accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]",

            compact ? "h-11 w-11" : "h-12 w-12",

            popoverOpen && "ring-2 ring-[var(--color-accent)]",

            disabled && "pointer-events-none opacity-45",

          )}

          style={{ backgroundColor: safeValue }}

          onMouseDown={(e) => e.preventDefault()}

          onClick={togglePopover}

        />

        <div className="min-w-0 flex-1">

          <Input

            value={hexDraft}

            disabled={disabled}

            error={hexError}

            placeholder="3b82f6"

            aria-label={`${ariaLabel} — hex code`}

            className="font-mono uppercase tracking-wide"

            onChange={(e) => {

              const next = e.target.value.replace(/[^0-9A-Fa-f#]/g, "").slice(0, 7);

              setHexDraft(next.replace(/^#/, ""));

              setHexError(undefined);

              if (next.length >= 6) commitHex(next);

            }}

            onBlur={() => {

              if (!commitHex(hexDraft)) {

                setHexDraft(safeValue.replace(/^#/, ""));

              }

            }}

          />

          {!compact && !inlinePresets && (

            <p className="mt-1 text-xs text-[var(--color-text-muted)]">

              Tap swatch for spectrum and presets

            </p>

          )}

        </div>



        {popoverOpen && (

          <div

            ref={popoverRef}

            id={popoverId}

            role="dialog"

            aria-label={`${ariaLabel} picker`}

            className="fixed z-[120] w-[15.5rem] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-2.5 shadow-[var(--shadow-elevated)]"

            style={{ top: popoverPos.top, left: popoverPos.left }}

            onPointerDown={(e) => e.stopPropagation()}

          >

            <HexColorPicker

              className={cn("domi-ops-color-picker", compact && "domi-ops-color-picker--compact")}

              color={safeValue}

              onChange={selectFromWheel}

            />

            <PresetSwatches

              presets={presets}

              safeValue={safeValue}

              disabled={disabled}

              ariaLabel={ariaLabel}

              listId={listId}

              size="popover"

              onSelect={selectPreset}

            />

            <Button

              type="button"

              size="sm"

              variant="secondary"

              className="mt-2 w-full"

              onClick={closePopover}

            >

              Done

            </Button>

          </div>

        )}

      </div>

    </div>

  );

}

