import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { plugin } = vi.hoisted(() => ({ plugin: {
  configure: vi.fn(), logIn: vi.fn(), logOut: vi.fn(), getOfferings: vi.fn(), purchasePackage: vi.fn(), restorePurchases: vi.fn(),
} }));
vi.mock("./capacitor-bridge", () => ({ getCapacitorPlugin: () => plugin }));
vi.mock("./native-shell", () => ({ isNativeShell: () => true, nativePlatform: () => "ios" }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_REVENUECAT_IOS_KEY", "appl_synthetic");
  for (const fn of [plugin.configure, plugin.logIn, plugin.logOut, plugin.purchasePackage, plugin.restorePurchases]) fn.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("does not charge another package when the requested interval is missing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ userId: "synthetic-owner" }) })));
  plugin.getOfferings.mockResolvedValue({ current: { availablePackages: [{ identifier: "starter_monthly", product: { identifier: "monthly" } }] } });
  const { purchaseStarterPackage } = await import("./revenuecat-client");
  expect((await purchaseStarterPackage("annual")).status).toBe("no_package");
  expect(plugin.purchasePackage).not.toHaveBeenCalled();
});
it("fails before SDK identity, offerings or charge when the server denies purchase access", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ message: "Only the household owner can purchase" }) })));
  const { purchaseStarterPackage, restorePurchases } = await import("./revenuecat-client");
  expect((await purchaseStarterPackage("monthly")).status).toBe("error");
  expect((await restorePurchases()).status).toBe("error");
  expect(plugin.configure).not.toHaveBeenCalled(); expect(plugin.getOfferings).not.toHaveBeenCalled(); expect(plugin.purchasePackage).not.toHaveBeenCalled(); expect(plugin.restorePurchases).not.toHaveBeenCalled();
});
it("binds the authorized account and charges exactly the selected package, including standard store identifiers", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ userId: "synthetic-owner" }) })); vi.stubGlobal("fetch", fetch);
  const annual = { identifier: "$rc_annual", product: { identifier: "annual" } };
  plugin.getOfferings.mockResolvedValue({ current: { availablePackages: [{ identifier: "starter_monthly" }, annual] } });
  const { purchaseStarterPackage, restorePurchases } = await import("./revenuecat-client");
  expect((await purchaseStarterPackage("annual")).status).toBe("ok");
  expect(plugin.configure).toHaveBeenCalledWith({ apiKey: "appl_synthetic", appUserID: "synthetic-owner" });
  expect(plugin.purchasePackage).toHaveBeenCalledExactlyOnceWith({ aPackage: annual });
  expect((await restorePurchases()).status).toBe("ok"); expect(plugin.restorePurchases).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/billing/purchase-access?action=restore", { credentials: "include", cache: "no-store" });
});
