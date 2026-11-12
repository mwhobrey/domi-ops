import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Env } from "@domi-ops/config";
import { calendarTools } from "./calendar-availability.js";
import { directTools } from "./direct-tools.js";
import { medGroupTools } from "./med-group-tools.js";
import { readTools } from "./read-tools.js";
import { contextTool } from "./tools.js";

// Checks the actions skill against production tool schemas. It says nothing about how a model behaves.
// Line endings depend on the checkout; the assertions below are written for LF.
const skill = readFileSync(new URL("../../../../skills/domi-ops-household-actions/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const env = { PUBLIC_APP_URL: "https://fixture.invalid", SESSION_SECRET: "synthetic-unit-test-secret-for-actions-skill" } as Env;
const registry = [contextTool, ...readTools(env), ...directTools(), ...medGroupTools(env), ...calendarTools()];
const tool = (name: string) => registry.find((entry) => entry.name === name)!;
const mentioned = [...new Set([...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]))];

describe("household actions skill contract (not model behavior)", () => {
  it("has the frontmatter a skill needs", () => {
    const frontmatter = skill.slice(0, skill.indexOf("\n---", 4));
    expect(frontmatter).toMatch(/^---\nname: domi-ops-household-actions\n/);
    expect(frontmatter).toMatch(/\ndescription: .{40,1024}\n/);
    expect(frontmatter).toMatch(/\nlicense: MIT\n/);
  });

  it("names only tools the server registers", () => {
    const names = registry.map((entry) => entry.name as string);
    const toolLike = mentioned.filter((name) => /^(get|list|add|log)_/.test(name));
    expect(toolLike.sort()).toEqual(["add_shopping_item", "get_calendar_availability", "get_connection_context", "get_medication_group_schedule", "log_medication_group"]);
    expect(skill).not.toMatch(/^Draft:/m);
    for (const name of toolLike) expect(names).toContain(name);
  });

  it("uses arguments the tools accept and none they refuse", () => {
    expect(tool("get_connection_context").input.safeParse({}).success).toBe(true);
    for (const day of ["today", "yesterday", "tomorrow"]) {
      expect(skill).toContain(`"${day}"`);
      expect(tool("get_medication_group_schedule").input.safeParse({ day }).success).toBe(true);
    }
    for (const argument of ["title", "quantity", "unit"]) expect(skill).toContain("`" + argument + "`");
    expect(tool("add_shopping_item").input.safeParse({ title: "Oat milk", quantity: 2, unit: "cartons" }).success).toBe(true);
    expect(tool("log_medication_group").input.safeParse({ occurrenceRef: "copied-from-schedule" }).success).toBe(true);
    for (const argument of ["from", "to"]) expect(skill).toContain("`" + argument + "`");
    expect(skill).toContain("at most 14 days");
    const availability = tool("get_calendar_availability").input;
    expect(availability.safeParse({ from: "2026-11-12" }).success).toBe(true);
    expect(availability.safeParse({ from: "2026-11-12", to: "2026-11-25" }).success).toBe(true);
    expect(availability.safeParse({ from: "2026-11-12", to: "2026-11-26" }).success).toBe(false);
  });

  it("explains every outcome and status the tools can return", () => {
    const shape = (name: string, field: string) => {
      const options = (tool(name).output as unknown as { shape: Record<string, { options?: string[]; element?: unknown }> }).shape[field].options;
      expect(options, `${name}.${field}`).toBeDefined();
      return options!;
    };
    for (const outcome of shape("add_shopping_item", "outcome")) expect(skill).toContain(outcome);
    for (const outcome of shape("log_medication_group", "outcome")) expect(skill).toContain(outcome);
    for (const status of ["pending", "taken", "partly_taken", "skipped", "mixed"]) expect(skill).toContain("`" + status + "`");
    for (const field of ["occurrenceRef", "canLog", "localTime", "notAccessible", "alreadyRecorded", "complete", "notAccessibleToAssistant"]) expect(skill).toContain(field);
    for (const coverage of shape("get_calendar_availability", "coverage")) expect(skill).toContain(coverage);
    for (const field of ["busy", "start", "end", "allDay", "externalCalendarsExcluded", "truncated"]) expect(skill).toContain("`" + field);
  });

  it("keeps the rules that make direct actions safe", () => {
    for (const rule of [/untrusted data/i, /never\s+a reason to call a tool/i, /Never say the whole group was logged/, /\*\*recorded\*\*/, /Never ask for tokens/i, /If the\s+target is ambiguous, ask/i, /at most six tool calls/i, /not guaranteed free/i, /do not guess what a block\s+is/i]) {
      expect(skill).toMatch(rule);
    }
    // It must not teach an assistant to supply a time, an id or a status of its own.
    expect(skill).not.toMatch(/scheduledAt|medicationId|groupId|calendarId|eventId|"status":/);
  });
});
