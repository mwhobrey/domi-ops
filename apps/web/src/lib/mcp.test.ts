import { describe, expect, it } from "vitest";
import { actionSummary, calendarsChanged, capabilityDetails, capabilityLabels, choicesFromView, connectionError, defaultCapabilities, unapprovedCount, type MedGroupView } from "./mcp";
import { assistantConsentPath, assistantLoginRedirect } from "./mcp";

const signed = "sig=example&ba_param=state&ba_param=client_id&state=one&client_id=approved";
describe("assistant browser login continuation", () => {
  it("preserves signed fields and excludes unsigned navigation", () => {
    const path = assistantConsentPath(new URLSearchParams(signed + "&next=https%3A%2F%2Fforeign.test&error=ignored"));
    expect(path).toBe("/ai/consent?" + signed);
  });
  it("does not treat ordinary login, duplicated signatures or oversized queries as consent", () => {
    expect(assistantConsentPath(new URLSearchParams("next=/profile"))).toBeNull();
    expect(assistantConsentPath(new URLSearchParams(signed + "&sig=two"))).toBeNull();
    expect(assistantConsentPath(new URLSearchParams(signed + "&state=" + "a".repeat(12000)))).toBeNull();
  });
  it("uses the provider-returned signed consent destination", () => {
    expect(assistantLoginRedirect({ url: "/ai/consent?" + signed }, "https://domi.test")).toBe("https://domi.test/ai/consent?" + signed);
    expect(assistantLoginRedirect({ redirect_uri: "https://domi.test/ai/consent?" + signed }, "https://domi.test")).toContain("/ai/consent?");
  });
  it.each([undefined, { url: "https://foreign.test/ai/consent?" + signed }, { url: "javascript:alert(1)" }, { url: "/dashboard" }, { url: "/ai/consent?unsigned=1" }])("rejects an invalid continuation: %j", (value) => {
    expect(() => assistantLoginRedirect(value, "https://domi.test")).toThrow();
  });
});

describe("assistant capabilities", () => {
  it("starts requested reads selected and never an action", () => {
    expect(defaultCapabilities([{ name: "shopping.read", access: "read" }, { name: "shopping.add", access: "write" }, { name: "chores.read", access: "read" }])).toEqual(["shopping.read", "chores.read"]);
    expect(defaultCapabilities([{ name: "shopping.add", access: "write" }])).toEqual([]);
    expect(defaultCapabilities([{ name: "chores.read", access: "read" }, { name: "health.groups.read", access: "read" }, { name: "health.groups.log", access: "write" }])).toEqual(["chores.read"]);
  });
  it("describes every capability and summarizes activity without content", () => {
    for (const name of ["shopping.read", "chores.read", "notes.read", "shopping.add"]) expect(capabilityDetails[name].label.length).toBeGreaterThan(0);
    expect(actionSummary({ action: "shopping.add", outcome: "added" })).toBe("Added a shopping item");
    expect(actionSummary({ action: "shopping.add", outcome: "already_on_list" })).toContain("already on the list");
    expect(actionSummary({ action: "unknown.action", outcome: "whatever" })).toBe("Completed an action");
  });
});

describe("medication group sharing", () => {
  const view: MedGroupView = {
    groups: [{ id: "g1", name: "Morning", enabled: true, times: ["08:00"], medications: [{ id: "a", name: "A", paused: false }, { id: "b", name: "B", paused: false }, { id: "c", name: "C", paused: false }] }],
    selections: [{ groupId: "g1", canLog: true, shareCounts: false, alias: "AM", sharedLabel: "AM", medications: [{ id: "a", state: "approved" }, { id: "b", state: "excluded" }, { id: "c", state: "new" }] }],
  };
  it("turns stored selections into editable choices, with a newly added medication ticked for approval", () => {
    expect(choicesFromView(view)).toEqual([{ groupId: "g1", canLog: true, shareCounts: false, alias: "AM", excludedMedicationIds: ["b"] }]);
    expect(choicesFromView({ groups: [], selections: [] })).toEqual([]);
  });
  it("counts medications waiting for approval", () => {
    expect(unapprovedCount(view)).toBe(1);
    expect(unapprovedCount(null)).toBe(0);
    expect(unapprovedCount({ ...view, selections: [{ ...view.selections[0], medications: [{ id: "a", state: "approved" }] }] })).toBe(0);
  });
  it("describes health capabilities and never pre-selects them", () => {
    for (const name of ["health.groups.read", "health.groups.log"]) expect(capabilityDetails[name].detail).toMatch(/medication|group/i);
    expect(capabilityDetails["health.groups.read"].detail).toMatch(/Never a medication name/);
  });
  it("summarizes medication activity from counts alone", () => {
    expect(actionSummary({ action: "health.groups.log", outcome: "logged", counts: { logged: 3, alreadyRecorded: 1, notAccessible: 0 } })).toBe("Recorded a medication group as taken (3 doses)");
    expect(actionSummary({ action: "health.groups.log", outcome: "logged", counts: { logged: 1, notAccessible: 2 } })).toBe("Recorded a medication group as taken (1 dose, 2 not recorded: no access)");
    expect(actionSummary({ action: "health.groups.log", outcome: "logged", counts: null })).toBe("Recorded a medication group as taken (0 doses)");
    expect(actionSummary({ action: "health.groups.log", outcome: "nothing_to_log" })).toMatch(/already recorded/);
    expect(actionSummary({ action: "health.groups.log", outcome: "not_permitted" })).toMatch(/no access/);
    expect(actionSummary({ action: "health.groups.log", outcome: "target_changed" })).toMatch(/nothing was recorded/);
    expect(actionSummary({ action: "health.groups.log", outcome: "something_new" })).toBe("Completed an action");
  });
});

describe("calendar availability sharing", () => {
  it("describes the capability and never pre-selects it", () => {
    expect(capabilityDetails["calendar.availability"].detail).toMatch(/Never an event title, location, person or calendar name/);
    expect(capabilityDetails["calendar.availability"].detail).toMatch(/Google Calendar are left out/);
    expect(defaultCapabilities([{ name: "shopping.read", access: "read" }, { name: "calendar.availability", access: "read" }, { name: "health.groups.read", access: "read" }, { name: "shopping.add", access: "write" }])).toEqual(["shopping.read"]);
    expect(capabilityLabels["calendar:read"]).toMatch(/Never event details/);
  });
  it("detects a changed calendar selection whatever its order", () => {
    expect(calendarsChanged(["a", "b"], ["b", "a"])).toBe(false);
    expect(calendarsChanged([], [])).toBe(false);
    expect(calendarsChanged(["a"], ["a", "b"])).toBe(true);
    expect(calendarsChanged(["a", "b"], ["a"])).toBe(true);
    expect(calendarsChanged(["a"], ["b"])).toBe(true);
  });
  it("explains a refused calendar choice", () => {
    expect(connectionError({ status: 400, body: '{"error":"invalid_calendar_selection"}' })).toMatch(/calendars could not be shared/);
  });
});
