import { describe, expect, it } from "vitest";
import { renderPostShareImage } from "./share-image";

describe("renderPostShareImage", () => {
  it("404s the Caregivers Day card before America/Chicago midnight on February 19, 2027", async () => {
    for (const now of [
      new Date("2026-11-24T15:00:00.000Z"),
      new Date("2027-02-19T00:00:00.000Z"),
      new Date("2027-02-19T05:59:59.000Z"),
    ]) {
      const res = renderPostShareImage("national-caregivers-day-coordination", now);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-cache, no-store");
    }
  });

  it("404s an unknown slug", () => {
    expect(renderPostShareImage("does-not-exist", new Date("2026-11-24T15:00:00.000Z")).status).toBe(404);
  });

  it("renders a 1200x630 PNG for a published post", async () => {
    const res = renderPostShareImage("why-i-built-domi-ops", new Date("2026-11-24T15:00:00.000Z"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }, 30_000);

  it("renders the Caregivers Day card from its Chicago midnight", () => {
    const res = renderPostShareImage("national-caregivers-day-coordination", new Date("2027-02-19T06:00:00.000Z"));
    expect(res.status).toBe(200);
  });
});
