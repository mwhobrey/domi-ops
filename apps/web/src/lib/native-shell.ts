/**
 * Detect the Capacitor store shell from the live web app (ADR 005).
 * Remote WebView loads apps/web — use runtime checks, not a Vite compile flag.
 */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function nativePlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return "web";
  const platform = cap.getPlatform?.();
  if (platform === "ios" || platform === "android") return platform;
  return "web";
}
