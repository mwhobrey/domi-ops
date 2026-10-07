"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SECTION_DEFAULTS,
  loadSectionState,
  saveSectionState,
  showSection,
  toggleSection,
  type SectionId,
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
 * over what was just loaded.
 */
export function useSectionOpen() {
  const [open, setOpen] = useState<SectionState>(SECTION_DEFAULTS);
  const current = useRef<SectionState>(SECTION_DEFAULTS);

  useEffect(() => {
    const saved = loadSectionState(browserStorage());
    current.current = saved;
    setOpen(saved);
  }, []);

  const apply = useCallback((next: SectionState) => {
    if (next === current.current) return;
    current.current = next;
    setOpen(next);
    saveSectionState(browserStorage(), next);
  }, []);

  const toggle = useCallback((id: SectionId) => apply(toggleSection(current.current, id)), [apply]);
  const show = useCallback((id: SectionId) => apply(showSection(current.current, id)), [apply]);

  return { open, toggle, show };
}
