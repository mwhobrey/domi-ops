import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Env } from "@domi-ops/config";
import { contextTool } from "./tools.js";
import { readTools } from "./read-tools.js";

type Step = { tool: string; args: Record<string, unknown>; records?: { id: string; date?: string | null }[]; text?: string; omitted?: boolean; cursor?: string; error?: string };
type Case = { id: string; prompt: string; now: string; timezone: string; householdDate: string; tools: string[]; steps: Step[]; expectedGroups?: Record<string, string[]>; review: string };
const cases = JSON.parse(readFileSync(new URL("../../../../docs/fixtures/mcp-briefing-cases.json", import.meta.url), "utf8")) as Case[];
// Replay authored examples against production schemas without a database or model.
const registry = [contextTool, ...readTools({ PUBLIC_APP_URL: "https://fixture.invalid" } as Env)];
const id = (value: string) => "00000000-0000-4000-8000-" + Buffer.from(value).toString("hex").padEnd(12, "0").slice(0, 12);

describe("portable briefing example contracts (not model behavior)", () => {
  for (const c of cases) it(c.id, () => {
    const available = [contextTool.name, ...c.tools];
    contextTool.input.parse({});
    contextTool.output.parse({ household: "Synthetic household", member: "Adult", timezone: c.timezone, capabilities: [...new Set(registry.filter((tool) => c.tools.includes(tool.name)).flatMap((tool) => tool.scopes))], tools: available });
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: c.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(c.now));
    expect(local).toBe(c.householdDate);
    expect(c.steps.length + 1).toBeLessThanOrEqual(12);
    const pages = new Map<string, number>(), cursors = new Map<string, string | null>(), selected = new Set<string>(), noteChunks = new Map<string, number>();
    const groups: Record<string, string[]> = { overdue: [], today: [], upcoming: [], undated: [] };
    for (const [index, step] of c.steps.entries()) {
      expect(available).toContain(step.tool);
      const tool = registry.find((t) => t.name === step.tool)!;
      const args = { ...step.args, ...(typeof step.args.noteId === "string" ? { noteId: id(step.args.noteId) } : {}) };
      tool.input.parse(args);
      if (step.tool.startsWith("list_")) {
        pages.set(step.tool, (pages.get(step.tool) ?? 0) + 1);
        expect(pages.get(step.tool)).toBeLessThanOrEqual(2);
        expect(step.args.limit).toBe(25);
        if (step.args.cursor) expect(step.args.cursor).toBe(cursors.get(step.tool));
        cursors.set(step.tool, step.cursor ?? null);
      }
      if (step.tool === "get_selected_note") {
        expect(selected.has(String(step.args.noteId))).toBe(true);
        noteChunks.set(String(step.args.noteId), (noteChunks.get(String(step.args.noteId)) ?? 0) + 1);
        expect(noteChunks.size).toBeLessThanOrEqual(3);
        expect(noteChunks.get(String(step.args.noteId))).toBeLessThanOrEqual(2);
      }
      if (step.error) {
        if (["rate_limited", "unauthorized", "deadline_exceeded"].includes(step.error)) expect(index).toBe(c.steps.length - 1);
        continue;
      }
      const records = (step.records ?? []).map((record) => {
        const path = step.tool === "list_chores" ? "/chores?highlight=" + id(record.id) : step.tool === "list_shopping_items" ? "/shopping" : "/notes";
        const base = { id: id(record.id), title: record.id, appLink: "https://fixture.invalid" + path };
        if (step.tool === "list_selected_notes") { selected.add(record.id); return { ...base, titleTruncated: false }; }
        if (step.tool === "list_shopping_items") return { ...base, quantity: null, unit: null, checked: false, aisle: null, fieldsTruncated: false };
        const date = record.date ?? null;
        groups[date === null ? "undated" : date < c.householdDate ? "overdue" : date === c.householdDate ? "today" : "upcoming"].push(record.id);
        if (step.args.dueBefore) { expect(date).not.toBeNull(); expect(date! <= String(step.args.dueBefore)).toBe(true); }
        return { ...base, titleTruncated: false, completed: false, dueDate: date, assignee: null };
      });
      const data = step.tool === "get_selected_note" ? { id: args.noteId, title: String(step.args.noteId), titleTruncated: false, text: step.text ?? "", textOmitted: step.omitted ?? false, omissionReason: step.omitted ? "linked_or_embedded_content" : null, appLink: "https://fixture.invalid/notes" } : records;
      tool.output.parse({ schemaVersion: 1, retrievedAt: c.now, householdTimezone: c.timezone, coverage: "persisted_records_only", contentTrust: "untrusted", nextCursor: step.cursor ?? null, truncated: Boolean(step.cursor), data });
    }
    if (c.expectedGroups) expect(groups).toEqual(c.expectedGroups);
  });
});
