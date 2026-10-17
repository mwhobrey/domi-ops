import { describe, expect, it } from "vitest";
import type { Database } from "@domi-ops/db";
import { telemetryRoutes } from "./telemetry.js";
describe("public optional metrics collector", () => {
  function fixture() {
    const stored: unknown[] = [];
    const db = { insert: () => ({ values: async (rows: unknown) => { stored.push(rows); } }) } as unknown as Database;
    const app = telemetryRoutes(db);
    return { stored, send: (body: unknown, route = "/events") => app.request(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
  }
  it("removes private errors, dynamic paths and metadata before storage", async () => {
    const { send, stored } = fixture();
    const response = await send({ events: [{ anonId: "00000000-0000-4000-8000-000000000001", kind: "error", name: "Private medical text and token=secret", path: "/health/record-id?secret=token", metadata: { medication: "private" } }] });
    expect(response.status).toBe(200);
    expect(stored).toMatchObject([[{ name: "browser_error", path: "/health", metadata: null }]]);
    for (const secret of ["medical text", "secret", "record-id", "medication"]) expect(JSON.stringify(stored)).not.toContain(secret);
    expect((await send({ events: [{ anonId: "00000000-0000-4000-8000-000000000001", kind: "usage", name: "User provided record title" }] })).status).toBe(400);
  });
  it("bounds requests before JSON parsing and keeps authored feedback separate", async () => {
    const { send, stored } = fixture();
    expect((await send({ events: "x".repeat(65536) })).status).toBe(413); expect(stored).toHaveLength(0);
    expect((await send({ anonId: "00000000-0000-4000-8000-000000000001", message: "Explicit user feedback", path: "/school/class/private-id" }, "/bug-report")).status).toBe(200);
    expect(stored).toMatchObject([{ message: "Explicit user feedback", path: "/school" }]);
  });
});
