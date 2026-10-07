/**
 * Which sections of the medications page are open (WHO-447). The page grew long (groups, medications, organizer, supplies,
 * pharmacies), so each can fold away and the choice is remembered per viewer in this browser. Supplies and pharmacies
 * start folded: they are the longest and the least often needed day to day.
 */
export const SECTION_IDS = ["groups", "medications", "organizer", "supplies", "pharmacies"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export type SectionState = Record<SectionId, boolean>;

export const SECTION_DEFAULTS: SectionState = {
  groups: true,
  medications: true,
  organizer: true,
  supplies: false,
  pharmacies: false,
};

export const SECTION_LABELS: Record<SectionId, string> = {
  groups: "Groups",
  medications: "Medications",
  organizer: "Pill organizer",
  supplies: "Supplies",
  pharmacies: "Pharmacies",
};

export const SECTION_STORAGE_KEY = "domi.health.sections.v1";

/** Reads what was saved, ignoring anything that is not a boolean for a known section, so a bad value never breaks the page. */
export function parseSectionState(raw: string | null): SectionState {
  const state = { ...SECTION_DEFAULTS };
  if (!raw) return state;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const id of SECTION_IDS) {
        const value = (parsed as Record<string, unknown>)[id];
        if (typeof value === "boolean") state[id] = value;
      }
    }
  } catch {
    // Not JSON: start from the defaults.
  }
  return state;
}

export const serializeSectionState = (state: SectionState): string => JSON.stringify(state);

/** The slice of the browser's Storage this page uses, so it can be faked in tests. */
export type SectionStorage = Pick<Storage, "getItem" | "setItem">;

/** Reads the saved choice; storage can throw (private windows, blocked site data), and then the defaults stand. */
export function loadSectionState(storage: SectionStorage | null): SectionState {
  try {
    return parseSectionState(storage ? storage.getItem(SECTION_STORAGE_KEY) : null);
  } catch {
    return { ...SECTION_DEFAULTS };
  }
}

/** Remembers the choice; a failure just means it is not remembered. */
export function saveSectionState(storage: SectionStorage | null, state: SectionState): void {
  try {
    storage?.setItem(SECTION_STORAGE_KEY, serializeSectionState(state));
  } catch {
    // Not remembered, still works.
  }
}

export const toggleSection = (state: SectionState, id: SectionId): SectionState => ({ ...state, [id]: !state[id] });

/** Opens a section; the same object back when it already is, so nothing re-renders. */
export const showSection = (state: SectionState, id: SectionId): SectionState => (state[id] ? state : { ...state, [id]: true });

/**
 * What is showing now, and what the person chose (what is remembered). They differ when a link opens a section for them:
 * that is shown, but it is not their choice, so it is neither saved nor carried into the next save of something else.
 */
export type SectionMemory = { current: SectionState; saved: SectionState };

/** Sets one section. `persist` false is for link-driven opens: shown now, not remembered. */
export function setSection(memory: SectionMemory, id: SectionId, open: boolean, persist: boolean): SectionMemory {
  const current = memory.current[id] === open ? memory.current : { ...memory.current, [id]: open };
  const saved = persist && memory.saved[id] !== open ? { ...memory.saved, [id]: open } : memory.saved;
  return current === memory.current && saved === memory.saved ? memory : { current, saved };
}

/** The pieces of the folded header's one-line summary, e.g. ["3 need a refill", "2 have no estimate"]. */
export function supplySummary(
  supplies: ReadonlyArray<{ enabled: boolean; supply?: { state: string } | null }>,
): string {
  let needs = 0;
  let requested = 0;
  let none = 0;
  let tracked = 0;
  for (const m of supplies) {
    if (!m.enabled) continue;
    const state = m.supply?.state;
    if (state === "needs_refill") needs += 1;
    else if (state === "requested") requested += 1;
    if (state === undefined || state === "no_estimate") none += 1;
    else tracked += 1;
  }
  const parts: string[] = [];
  if (needs > 0) parts.push(`${needs} ${needs === 1 ? "needs" : "need"} a refill`);
  if (requested > 0) parts.push(`${requested} requested`);
  if (none > 0) parts.push(`${none} without an estimate`);
  if (parts.length > 0) return parts.join(" · ");
  return tracked > 0 ? "Nothing needs a refill" : "No medications yet";
}

export const countLabel = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
