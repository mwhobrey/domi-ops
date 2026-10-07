"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SECTION_DEFAULTS,
  loadSectionState,
  saveSectionState,
  setSection,
  type SectionId,
  type SectionMemory,
  type SectionState,
  type SectionStorage,
} from "./section-state";

function browserStorage(): SectionStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Open/folded state of the medications page's sections, remembered in this browser (WHO-447). The saved choice is read once
 * after the first render, so the server and the first client render agree. It is written only when the person changes a
 * section, never from an effect: an effect that wrote the state would run in the same pass as the read and save the defaults
 * over what was just loaded. A section a link opens (`show(id, false)`) is shown but not remembered.
 */
export function useSectionOpen() {
  const [open, setOpen] = useState<SectionState>(SECTION_DEFAULTS);
  const memory = useRef<SectionMemory>({ current: SECTION_DEFAULTS, saved: SECTION_DEFAULTS });

  useEffect(() => {
    const saved = loadSectionState(browserStorage());
    memory.current = { current: saved, saved };
    setOpen(saved);
  }, []);

  const change = useCallback((id: SectionId, next: boolean, persist: boolean) => {
    const before = memory.current;
    const after = setSection(before, id, next, persist);
    if (after === before) return;
    memory.current = after;
    if (after.current !== before.current) setOpen(after.current);
    if (after.saved !== before.saved) saveSectionState(browserStorage(), after.saved);
  }, []);

  const toggle = useCallback((id: SectionId) => change(id, !memory.current.current[id], true), [change]);
  const show = useCallback((id: SectionId, persist = true) => change(id, true, persist), [change]);

  return { open, toggle, show };
}
