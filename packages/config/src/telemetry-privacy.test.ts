import { describe, expect, it } from "vitest";
import { privateTelemetryFields, telemetryRoute } from "./telemetry-privacy.js";
describe("optional metrics privacy boundary", () => {
  it("strips record ids, credentials, error text and arbitrary metadata", () => {
    expect(privateTelemetryFields({ kind: "error", name: "Medication Alice secret=oauth_token", path: "/health/private-record?token=secret", metadata: { email: "alice@example.test" } })).toEqual({ kind: "error", name: "browser_error", path: "/health", metadata: null, value: null });
    expect(privateTelemetryFields({ kind: "usage", name: "Alice private health title" })).toBeNull();
    expect(telemetryRoute("https://private.example/token")).toBeNull();
    expect(telemetryRoute("/join/secret-token")).toBeNull();
  });
  it("accepts only bounded measurements and fixed usage names", () => {
    expect(privateTelemetryFields({ kind: "usage", name: "page.viewed", path: "/school/class/123" })?.path).toBe("/school");
    expect(privateTelemetryFields({ kind: "web_vital", name: "LCP", value: 3.2, metadata: { rating: "good", private: "secret" } })).toMatchObject({ value: 3, metadata: { rating: "good" } });
    expect(privateTelemetryFields({ kind: "web_vital", name: "LCP", value: 1e50 })?.value).toBe(2147483647);
  });
});
