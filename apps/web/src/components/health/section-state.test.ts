import { describe, expect, it } from "vitest";
import {
  SECTION_DEFAULTS,
  SECTION_STORAGE_KEY,
  countLabel,
  loadSectionState,
  parseSectionState,
  saveSectionState,
  serializeSectionState,
  showSection,
  supplySummary,
  toggleSection,
} from "./section-state";

describe("parseSectionState", () => {
  it("starts from the defaults when nothing was saved", () => {
    expect(parseSectionState(null)).toEqual(SECTION_DEFAULTS);
    expect(parseSectionState("")).toEqual(SECTION_DEFAULTS);
  });

  it("keeps supplies and pharmacies folded and the rest open by default", () => {
    expect(SECTION_DEFAULTS).toEqual({ groups: true, medications: true, organizer: true, supplies: false, pharmacies: false });
  });

  it("round-trips what was saved", () => {
    const saved = { ...SECTION_DEFAULTS, supplies: true, groups: false };
    expect(parseSectionState(serializeSectionState(saved))).toEqual(saved);
  });

  it("ignores anything that is not a boolean for a known section", () => {
    expect(parseSectionState(JSON.stringify({ supplies: "yes", organizer: 0, nonsense: true, groups: false }))).toEqual({
      ...SECTION_DEFAULTS,
      groups: false,
    });
  });

  it("falls back to the defaults for broken or odd JSON", () => {
    expect(parseSectionState("{not json")).toEqual(SECTION_DEFAULTS);
    expect(parseSectionState("[true, false]")).toEqual(SECTION_DEFAULTS);
    expect(parseSectionState("null")).toEqual(SECTION_DEFAULTS);
    expect(parseSectionState('"text"')).toEqual(SECTION_DEFAULTS);
  });

  it("does not hand out the shared defaults object", () => {
    const a = parseSectionState(null);
    a.supplies = true;
    expect(SECTION_DEFAULTS.supplies).toBe(false);
  });
});

describe("supplySummary", () => {
  const med = (state: string | undefined, enabled = true) => ({ enabled, supply: state === undefined ? null : { state } });

  it("counts what needs a refill, what was requested and what has no estimate", () => {
    expect(supplySummary([med("needs_refill"), med("needs_refill"), med("requested"), med("no_estimate"), med(undefined), med("ok")])).toBe(
      "2 need a refill · 1 requested · 2 without an estimate",
    );
  });

  it("uses the singular for one", () => {
    expect(supplySummary([med("needs_refill")])).toBe("1 needs a refill");
  });

  it("says nothing needs a refill when estimates exist and all is well", () => {
    expect(supplySummary([med("ok"), med("not_needed")])).toBe("Nothing needs a refill");
  });

  it("leaves paused medications out and says so when there is nothing", () => {
    expect(supplySummary([med("needs_refill", false)])).toBe("No medications yet");
    expect(supplySummary([])).toBe("No medications yet");
  });
});

describe("countLabel", () => {
  it("picks one or many", () => {
    expect(countLabel(1, "group", "groups")).toBe("1 group");
    expect(countLabel(0, "group", "groups")).toBe("0 groups");
    expect(countLabel(12, "medication", "medications")).toBe("12 medications");
  });
});

describe("loading, saving and changing sections", () => {
  const fakeStorage = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [[SECTION_STORAGE_KEY, initial]]);
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  it("loads what was saved, and the defaults when there is no storage or it throws", () => {
    const saved = { ...SECTION_DEFAULTS, groups: false, supplies: true };
    expect(loadSectionState(fakeStorage(JSON.stringify(saved)))).toEqual(saved);
    expect(loadSectionState(null)).toEqual(SECTION_DEFAULTS);
    expect(loadSectionState(throwing)).toEqual(SECTION_DEFAULTS);
  });

  it("saves, and does not fail when storage throws or is missing", () => {
    const storage = fakeStorage();
    saveSectionState(storage, { ...SECTION_DEFAULTS, supplies: true });
    expect(JSON.parse(storage.data.get(SECTION_STORAGE_KEY)!).supplies).toBe(true);
    expect(() => saveSectionState(throwing, SECTION_DEFAULTS)).not.toThrow();
    expect(() => saveSectionState(null, SECTION_DEFAULTS)).not.toThrow();
  });

  it("toggles one section without touching the others or the original", () => {
    const next = toggleSection(SECTION_DEFAULTS, "supplies");
    expect(next.supplies).toBe(true);
    expect({ ...next, supplies: false }).toEqual(SECTION_DEFAULTS);
    expect(SECTION_DEFAULTS.supplies).toBe(false);
    expect(toggleSection(next, "supplies").supplies).toBe(false);
  });

  it("shows a folded section and hands back the same object for one already open", () => {
    expect(showSection(SECTION_DEFAULTS, "pharmacies").pharmacies).toBe(true);
    expect(showSection(SECTION_DEFAULTS, "groups")).toBe(SECTION_DEFAULTS);
  });
});
