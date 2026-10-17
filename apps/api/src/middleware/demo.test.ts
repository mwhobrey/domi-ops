import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { createDemoProtectionMiddleware } from "./demo.js";
describe("public demo boundaries", () => {
  const app = new Hono(); app.use("*", createDemoProtectionMiddleware({ DEMO_MODE: true } as Env)); app.all("*", (c) => c.json({ ok: true }));
  it("blocks real account connections, email invitations and billing", async () => {
    for (const [method, path] of [["GET", "/auth/google/calendar/start"], ["POST", "/auth/sign-in/social"], ["POST", "/api/core/household/invitations"], ["POST", "/api/billing/checkout"], ["POST", "/api/health/withings/links/id/connect"], ["DELETE", "/api/core/household/members/id"]]) {
      expect((await app.request(path, { method })).status).toBe(403);
    }
  });
  it("keeps sample editing and credential login available", async () => {
    expect((await app.request("/api/core/chores", { method: "POST" })).status).toBe(200);
    expect((await app.request("/auth/sign-in/email", { method: "POST" })).status).toBe(200);
    expect((await app.request("/api/core/household/invitations")).status).toBe(200);
  });
});
