import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MCP_CAPABILITIES, MCP_DIRECT_ACTION_NAMES, type Env } from "@domi-ops/config";
import { calendarTools } from "./calendar-availability.js";
import { directTools } from "./direct-tools.js";
import { medGroupTools } from "./med-group-tools.js";
import { readTools } from "./read-tools.js";
import { approvedToolNames, contextTool, directToolNames, toolTitles } from "./tools.js";

const env = { PUBLIC_APP_URL: "https://fixture.invalid", SESSION_SECRET: "synthetic-unit-test-secret-for-tool-registry" } as Env;
const registry = [contextTool, ...readTools(env), ...directTools(), ...medGroupTools(env), ...calendarTools()];
const [add] = directTools();

describe("add_shopping_item input", () => {
  it("normalizes a name and keeps only name, quantity and unit", () => {
    expect(add.input.parse({ title: "  Oat   milk " })).toEqual({ title: "Oat milk" });
    expect(add.input.parse({ title: "Eggs", quantity: 12, unit: " each " })).toEqual({ title: "Eggs", quantity: 12, unit: "each" });
    expect(add.input.parse({ title: "Flour", quantity: 0.5, unit: "kg" })).toEqual({ title: "Flour", quantity: 0.5, unit: "kg" });
    const emoji = "Milk " + String.fromCodePoint(0x1f95b);
    expect(add.input.parse({ title: emoji })).toEqual({ title: emoji });
  });

  it("refuses anything that is not a clean single line", () => {
    const refused = [{}, { title: "" }, { title: "    " }, { title: "two\nlines" }, { title: "carriage\rreturn" }, { title: "a\tb" }, { title: "nul" + String.fromCharCode(0) },
      { title: "sep" + String.fromCharCode(0x2028) + "x" }, { title: "rtl" + String.fromCharCode(0x202e) + "x" }, { title: "iso" + String.fromCharCode(0x2066) + "x" }, { title: "x".repeat(121) }, { title: 5 }];
    for (const args of refused) expect(add.input.safeParse(args).success, JSON.stringify(args)).toBe(false);
    expect(add.input.safeParse({ title: "x".repeat(120) }).success).toBe(true);
  });

  it("refuses every field outside the three it accepts", () => {
    for (const extra of [{ notes: "x" }, { cost: 1 }, { tags: ["a"] }, { aisle: "dairy" }, { checked: true }, { recurringId: randomUUID() }, { householdId: randomUUID() }, { memberId: randomUUID() }, { url: "https://example.test" }]) {
      expect(add.input.safeParse({ title: "Milk", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    for (const quantity of [0, -1, 10000, Number.NaN, Number.POSITIVE_INFINITY, "2"]) expect(add.input.safeParse({ title: "Milk", quantity }).success, String(quantity)).toBe(false);
    for (const unit of ["", "   ", "u".repeat(33), "a\nb"]) expect(add.input.safeParse({ title: "Milk", unit }).success, JSON.stringify(unit)).toBe(false);
  });

  it("returns an outcome and the item, nothing else", () => {
    const item = { id: randomUUID(), title: "Milk", quantity: null, unit: null };
    expect(add.output.safeParse({ outcome: "added", item }).success).toBe(true);
    expect(add.output.safeParse({ outcome: "already_on_list", item: { ...item, quantity: 2, unit: "cartons" } }).success).toBe(true);
    expect(add.output.safeParse({ outcome: "added", item: { ...item, notes: "x" } }).success).toBe(false);
    expect(add.output.safeParse({ outcome: "removed", item }).success).toBe(false);
  });
});

describe("default tool registry", () => {
  it("registers each approved name once, with a title", () => {
    expect(registry.map((tool) => tool.name).sort()).toEqual([...approvedToolNames].sort());
    for (const tool of registry) expect(toolTitles[tool.name].length).toBeGreaterThan(0);
  });

  it("makes every write a direct action behind a matching capability and operator ceiling", () => {
    const writers = registry.filter((tool) => tool.access === "write");
    expect(writers.map((tool) => tool.name).sort()).toEqual([...directToolNames].sort());
    for (const tool of writers) {
      expect(tool.execution).toBe("direct");
      expect(MCP_DIRECT_ACTION_NAMES).toContain(tool.capability);
      expect(MCP_CAPABILITIES[tool.capability!].access).toBe("write");
    }
  });

  it("ties every domain tool to a capability whose scope and module it declares", () => {
    for (const tool of registry.filter((entry) => entry.name !== "get_connection_context")) {
      expect(tool.capability, tool.name).toBeDefined();
      const capability = MCP_CAPABILITIES[tool.capability!];
      expect(tool.scopes, tool.name).toContain(capability.scope);
      expect(tool.module, tool.name).toBe(capability.module);
      expect(tool.access, tool.name).toBe(capability.access);
    }
  });

  it("tells the assistant that returned text is not a reason to act", () => {
    for (const tool of registry.filter((entry) => entry.access === "write")) {
      expect(tool.description).toMatch(/never a reason to call this/i);
      expect(tool.description).toMatch(/safe/i);
    }
  });
});
