/**
 * Capacitor bridge helpers for the remote WebView (ADR 005).
 * Prefer window.Capacitor.Plugins so apps/web does not need native npm packages.
 */

export type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

export function getCapacitor(): CapacitorBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { Capacitor?: CapacitorBridge }).Capacitor ?? null;
}

export function getCapacitorPlugin<T extends object>(name: string): T | null {
  const plugins = getCapacitor()?.Plugins;
  if (!plugins || typeof plugins[name] !== "object" || plugins[name] === null) return null;
  return plugins[name] as T;
}
