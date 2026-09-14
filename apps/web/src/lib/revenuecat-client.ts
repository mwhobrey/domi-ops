/**
 * RevenueCat client for Capacitor store builds (WHO-290 / ADR 005).
 *
 * Web keeps Stripe. Never return the Purchases plugin proxy from an async function —
 * the bridge probes `.then` and throws "Purchases.then() is not implemented".
 */
import { getCapacitorPlugin } from "./capacitor-bridge";
import { isNativeShell, nativePlatform } from "./native-shell";

type PurchasesPlugin = {
  configure: (opts: { apiKey: string; appUserID?: string }) => Promise<void>;
  logIn: (opts: { appUserID: string }) => Promise<unknown>;
  logOut: () => Promise<unknown>;
  getOfferings: () => Promise<{
    current?: { availablePackages?: Array<{ identifier: string; product?: { identifier?: string } }> };
  }>;
  purchasePackage: (opts: { aPackage: unknown }) => Promise<unknown>;
  restorePurchases: () => Promise<unknown>;
};

let _Purchases: PurchasesPlugin | null = null;
let _configuredUid: string | null = null;

function apiKeyForPlatform(): string {
  const platform = nativePlatform();
  if (platform === "ios") {
    return (process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY ?? "").trim();
  }
  if (platform === "android") {
    return (process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY ?? "").trim();
  }
  return "";
}

function ensurePurchasesSync(): boolean {
  if (!isNativeShell()) return false;
  if (!_Purchases) {
    _Purchases = getCapacitorPlugin<PurchasesPlugin>("Purchases");
  }
  return _Purchases != null && Boolean(apiKeyForPlatform());
}

export function isRevenueCatAvailable(): boolean {
  return isNativeShell() && Boolean(apiKeyForPlatform()) && Boolean(getCapacitorPlugin("Purchases"));
}

/** Point RevenueCat at Domi Ops users.id. Safe on every auth change. */
export async function syncRevenueCatUser(uid: string | null | undefined): Promise<void> {
  if (!uid || !ensurePurchasesSync() || !_Purchases || uid === _configuredUid) return;
  try {
    if (_configuredUid === null) {
      await _Purchases.configure({ apiKey: apiKeyForPlatform(), appUserID: uid });
    } else {
      await _Purchases.logIn({ appUserID: uid });
    }
    _configuredUid = uid;
  } catch (err) {
    console.warn("[domi-ops revenuecat] user sync failed", err);
  }
}

export async function logOutRevenueCat(): Promise<void> {
  if (!ensurePurchasesSync() || !_Purchases || _configuredUid === null) return;
  try {
    await _Purchases.logOut();
    _configuredUid = null;
  } catch (err) {
    console.warn("[domi-ops revenuecat] logout failed", err);
  }
}

export type PurchaseResult =
  | { status: "ok" }
  | { status: "cancelled" | "not_available" | "no_offering" | "no_package" | "error"; message?: string };

/** Purchase Starter monthly/annual via current RevenueCat offering. */
export async function purchaseStarterPackage(
  plan: "monthly" | "annual",
): Promise<PurchaseResult> {
  if (!ensurePurchasesSync() || !_Purchases) return { status: "not_available" };
  try {
    const offerings = await _Purchases.getOfferings();
    const packages = offerings?.current?.availablePackages ?? [];
    if (packages.length === 0) return { status: "no_offering" };

    const want = plan === "monthly" ? "starter_monthly" : "starter_annual";
    const alt = plan === "monthly" ? "monthly" : "annual";
    const pkg =
      packages.find((p) => p.identifier === want || p.identifier === alt) ??
      packages.find((p) => p.product?.identifier?.includes(plan)) ??
      packages[0];
    if (!pkg) return { status: "no_package" };

    await _Purchases.purchasePackage({ aPackage: pkg });
    return { status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(msg)) return { status: "cancelled" };
    return { status: "error", message: msg };
  }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!ensurePurchasesSync() || !_Purchases) return { status: "not_available" };
  try {
    await _Purchases.restorePurchases();
    return { status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", message: msg };
  }
}

/** Open the platform subscription management UI when possible. */
export function openNativeSubscriptionManage(): void {
  if (typeof window === "undefined") return;
  const platform = nativePlatform();
  if (platform === "ios") {
    window.open("https://apps.apple.com/account/subscriptions", "_blank");
  } else if (platform === "android") {
    window.open("https://play.google.com/store/account/subscriptions", "_blank");
  }
}
