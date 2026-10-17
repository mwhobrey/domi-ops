import { expect, it, vi } from "vitest";
import type { Env } from "@domi-ops/config";
const captured = vi.hoisted(() => ({ envelopes: [] as unknown[] }));
vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return { ...actual, init: (options: Parameters<typeof actual.init>[0]) => actual.init({
    ...options, defaultIntegrations: false,
    transport: () => ({ send: async (envelope) => { captured.envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }),
  }) };
});
import * as Sentry from "@sentry/node";
import { initSentry } from "./sentry.js";

it("the configured SDK transport receives scrubbed events without private attachments", async () => {
  const secret = "PRIVATE_DIAGNOSTIC_TEST_MEDICATION_AND_TOKEN";
  initSentry({ SENTRY_DSN: "https://synthetic@example.test/1", NODE_ENV: "test" } as Env);
  try {
    Sentry.withScope((scope) => {
      scope.setUser({ id: secret, email: secret });
      scope.setExtra("sqlParameters", [secret]);
      scope.setContext("private", { token: secret });
      scope.addAttachment({ filename: "private.txt", data: secret });
      Sentry.captureException(new Error(secret));
    });
    await Sentry.flush(2000);
    expect(captured.envelopes.length).toBeGreaterThan(0);
    expect(JSON.stringify(captured.envelopes)).not.toContain(secret);
    expect(JSON.stringify(captured.envelopes)).toContain("Error details omitted for privacy");
  } finally { await Sentry.close(2000); }
});
