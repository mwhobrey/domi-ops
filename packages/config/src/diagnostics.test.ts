import { describe, expect, it } from "vitest";
import { scrubDiagnosticEvent } from "./diagnostics.js";
describe("diagnostic privacy boundary", () => {
  it("removes content, tokens, identifiers and SQL parameters while preserving useful code locations", () => {
    const secret = "PRIVATE_MEDICAL_AND_OAUTH_SENTINEL";
    const original = {
      event_id: "abc123", level: "error", environment: "production", message: secret,
      logentry: { message: secret, params: [secret] }, extra: { query: secret },
      user: { id: secret, email: secret, ip_address: secret }, tags: { householdId: secret, jobName: "health.med.reminder.household" },
      request: { method: "POST", url: `https://app.test/join?token=${secret}`, headers: { cookie: secret }, data: secret },
      contexts: { trace: { data: secret } }, breadcrumbs: [{ message: secret }], transaction: secret,
      exception: { values: [{ type: "DatabaseError", value: secret, stacktrace: { frames: [{ filename: `https://app.test/static/app.js?token=${secret}`, function: "saveReport", lineno: 21, colno: 4, in_app: true, vars: { input: secret } }] } }] },
    };
    const result = scrubDiagnosticEvent(original);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.exception.values[0].stacktrace.frames[0]).toEqual({ filename: "app.js", function: "saveReport", lineno: 21, colno: 4, in_app: true });
    expect(result.request).toEqual({ method: "POST" });
    expect(original.message).toBe(secret);
  });
  it("never forwards arbitrary console text", () => {
    expect(scrubDiagnosticEvent({ message: "private title", extra: { arguments: ["password"] } })).toEqual({ message: "Domi Ops error; details omitted for privacy" });
  });
});
