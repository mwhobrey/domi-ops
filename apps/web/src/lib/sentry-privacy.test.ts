import { afterEach, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type Transport = ReturnType<NonNullable<InitOptions["transport"]>>;
type Envelope = Parameters<Transport["send"]>[0];

const { envelopes } = vi.hoisted(() => ({ envelopes: [] as Envelope[] }));

vi.mock("@sentry/nextjs", async () => {
  const { createRequire } = await import("node:module");
  const sdk = createRequire(import.meta.url)("@sentry/nextjs") as typeof import("@sentry/nextjs");
  return {
    ...sdk,
    init: (options: Parameters<typeof sdk.init>[0]) => sdk.init({
      ...options,
      transport: () => ({
        send: async (envelope: Envelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
        flush: async () => true,
      }),
    }),
  };
});

afterEach(async () => {
  await Sentry.close(2000);
  vi.unstubAllEnvs();
});

it("sends useful errors through Sentry v11 without private scope data or attachments", async () => {
  vi.stubEnv("SENTRY_DSN", "https://public@sentry.invalid/1");
  await import("../sentry.server.config");
  const secret = "PRIVATE_HEALTH_OAUTH_AND_QUEUE_SENTINEL";

  Sentry.withScope((scope) => {
    scope.setUser({ id: secret, email: `${secret}@example.test`, ip_address: "192.0.2.1" });
    scope.setExtra("queueArguments", { householdId: secret, medication: secret });
    scope.setContext("private", { cookie: secret, requestBody: secret });
    scope.addAttachment({ filename: "private.txt", data: secret });
    Sentry.captureException(new Error(secret));
  });
  Sentry.startSpan({ name: secret }, () => {});
  Sentry.logger.info(secret);
  Sentry.metrics.count(secret);
  expect(await Sentry.flush(2000)).toBe(true);

  const serialized = JSON.stringify(envelopes);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain("192.0.2.1");
  expect(serialized).not.toContain('"attachment"');
  expect(serialized).toContain("Error details omitted for privacy");
  expect(serialized).toContain("sentry-privacy.test.ts");
  const itemTypes = envelopes.flatMap((envelope) => envelope[1].map(([header]) => header.type));
  expect(itemTypes.filter((type) => type !== "client_report")).toEqual(["event"]);
});
