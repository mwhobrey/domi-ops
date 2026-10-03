import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

/**
 * The service worker's `notificationclick` handler, run in a stubbed worker scope (WHO-388). It is
 * the one part of a reminder's action buttons that no server test reaches, and it has to choose the
 * right endpoint: a check reminder carries a token and a "skip" just like a medication one does.
 */
const SW = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

type Fetch = (url: string, init: { method: string; body: string }) => Promise<{ ok: boolean }>;

function load(fetchImpl: Fetch) {
  const listeners = new Map<string, (event: unknown) => void>();
  const opened: string[] = [];
  const messages: unknown[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const client = {
    focus: async () => undefined,
    navigate: async (url: string) => {
      opened.push(url);
    },
    postMessage: (m: unknown) => messages.push(m),
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    registration: {},
    clients: { matchAll: async () => [client], openWindow: async (url: string) => opened.push(url), claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const sandbox = {
    self,
    URL,
    URLSearchParams,
    caches: { open: async () => ({ addAll: async () => undefined }), keys: async () => [], match: async () => undefined },
    clients: self.clients,
    fetch: async (url: string, init: { method: string; body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return fetchImpl(url, init);
    },
  };
  vm.runInNewContext(SW, sandbox);

  /** Click `action` on a notification with `data`; resolves when the worker has finished. */
  async function click(action: string, data: Record<string, unknown>) {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get("notificationclick")!({
      action,
      notification: { data, close: () => undefined },
      waitUntil: (p: Promise<unknown>) => {
        work = p;
      },
    });
    await work;
  }
  return { click, calls, opened, messages };
}

const checkData = {
  checkId: "check-1",
  scheduledAt: "2026-10-02T17:05:00.000Z",
  timeZone: "America/Chicago",
  token: "tok",
  url: "/health?check=check-1&scheduledAt=2026-10-02T17%3A05%3A00.000Z",
};

describe("sw.js notificationclick for health reminders", () => {
  it("Skip on a check reminder posts the token and device time zone to the check endpoint", async () => {
    const sw = load(async () => ({ ok: true }));
    await sw.click("skip", checkData);
    expect(sw.calls).toEqual([
      { url: "/api/health/checks/push-action", body: { token: "tok", action: "skip", timeZone: "America/Chicago" } },
    ]);
    expect(sw.opened).toEqual([]);
    expect(sw.messages).toEqual([{ type: "domi-ops:check-logged", checkId: "check-1", action: "skip" }]);
  });

  it("falls back to opening the slot when the skip is refused or the network fails", async () => {
    const refused = load(async () => ({ ok: false }));
    await refused.click("skip", checkData);
    expect(refused.opened).toEqual([`https://app.test${checkData.url}`]);
    expect(refused.messages).toEqual([]);

    const offline = load(async () => {
      throw new Error("offline");
    });
    await offline.click("skip", checkData);
    expect(offline.opened).toEqual([`https://app.test${checkData.url}`]);
  });

  it("Log now, and tapping the body, just open the slot without posting anything", async () => {
    const sw = load(async () => ({ ok: true }));
    await sw.click("log", checkData);
    await sw.click("", checkData);
    expect(sw.calls).toEqual([]);
    expect(sw.opened).toEqual([`https://app.test${checkData.url}`, `https://app.test${checkData.url}`]);
  });

  it("a medication Skip still goes to the medication endpoint, and a group's to the group endpoint", async () => {
    const sw = load(async () => ({ ok: true }));
    await sw.click("skip", { medicationId: "med-1", scheduledAt: "2026-10-02T17:05:00.000Z", token: "t" });
    await sw.click("skip", { medicationGroupId: "g-1", scheduledAt: "2026-10-02T17:05:00.000Z", token: "t" });
    expect(sw.calls.map((c) => c.url)).toEqual([
      "/api/health/medications/push-action",
      "/api/health/medication-groups/push-action",
    ]);
  });
});
