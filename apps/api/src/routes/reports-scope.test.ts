import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { buildExpenseReports } from "../lib/expenses.js";
import type { CanonicalReport } from "../lib/reports/types.js";
import { reportRoutes } from "./reports.js";

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: { req: { header: (name: string) => string | undefined }; set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("auth", {
      householdId: "household",
      userId: "viewer",
      memberId: c.req.header("x-no-member") ? undefined : "viewer-member",
    });
    await next();
  },
}));

vi.mock("../lib/expenses.js", () => ({
  buildExpenseReports: vi.fn(async (_db, _household, month, opts) => ({
    month,
    scope: opts?.scope ?? "household",
    monthSpend: opts?.scope === "personal" ? 25 : 200,
    monthBudgeted: 0,
    percentUsed: null,
    expenseCount: 1,
    byCategory: [],
    recentBigSpends: [],
  })),
}));

vi.mock("../lib/reports/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/reports/index.js")>(),
  moduleEnabledForReports: vi.fn(async () => true),
  executeReportExport: vi.fn(async ({ report }) => ({ preview: report })),
}));

describe("expense report filter scope", () => {
  const db = {} as Database;
  const app = reportRoutes(db, {} as Env);
  beforeEach(() => vi.clearAllMocks());

  it.each(["preview", "domi-ops-drive", "google-drive", "google-docs"])(
    "keeps the Me filter for %s and uses the signed-in member",
    async (destination) => {
      const res = await app.request("/reports/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module: "expenses", kind: "overview", month: "2026-10", scope: "personal", memberId: "another-member", destination }),
      });
      expect(res.status).toBe(200);
      expect(buildExpenseReports).toHaveBeenCalledWith(db, "household", "2026-10", { scope: "personal", memberId: "viewer-member" });
      const { preview } = await res.json() as { preview: CanonicalReport };
      expect(preview.title).toContain("Personal spending");
      expect(preview.sections[0]?.stats?.[0]?.value).toBe("$25.00");
    },
  );

  it.each([undefined, "household"])("retains household exports for scope %s", async (scope) => {
    const res = await app.request("/reports/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ module: "expenses", kind: "overview", month: "2026-10", scope }),
    });
    expect(res.status).toBe(200);
    expect(buildExpenseReports).toHaveBeenCalledWith(db, "household", "2026-10", { scope: "household", memberId: undefined });
    const { preview } = await res.json() as { preview: CanonicalReport };
    expect(preview.sections[0]?.stats?.[0]?.value).toBe("$200.00");
  });

  it("applies the same personal scope to canonical report reads", async () => {
    const res = await app.request("/reports?module=expenses&kind=overview&month=2026-10&scope=personal");
    expect(res.status).toBe(200);
    expect(buildExpenseReports).toHaveBeenCalledWith(db, "household", "2026-10", { scope: "personal", memberId: "viewer-member" });
  });

  it("does not fall back to household data when a personal export has no member", async () => {
    const res = await app.request("/reports/export", {
      method: "POST",
      headers: { "content-type": "application/json", "x-no-member": "1" },
      body: JSON.stringify({ module: "expenses", kind: "overview", month: "2026-10", scope: "personal" }),
    });
    expect(res.status).toBe(404);
    expect(buildExpenseReports).not.toHaveBeenCalled();
  });
});
