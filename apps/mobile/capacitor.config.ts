import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor store shell (ADR 005 / WHO-287).
 *
 * Product UI is NOT bundled — the WebView loads a user-chosen origin (default
 * https://app.domi-ops.com). Local `www/` is only the first-run server picker.
 *
 * `allowNavigation: ["*"]` keeps arbitrary self-host URLs inside the WebView with
 * the Capacitor bridge injected (required for Preferences / push / IAP). Without
 * the wildcard, Capacitor opens unlisted hosts in the system browser and plugins die.
 */
const config: CapacitorConfig = {
  appId: "app.domiops",
  appName: "Domi Ops",
  webDir: "www",
  server: {
    androidScheme: "https",
    allowNavigation: ["*"],
  },
  android: {
    backgroundColor: "#0c0f14",
    webContentsDebuggingEnabled: true,
  },
  ios: {
    backgroundColor: "#0c0f14",
    contentInset: "automatic",
    preferredContentMode: "mobile",
  },
  plugins: {
    /**
     * Native HTTP so the server-picker healthz probe is not subject to WebView CORS
     * (www is served from https://localhost → cross-origin to the typed server).
     */
    CapacitorHttp: {
      enabled: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0c0f14",
    },
    SplashScreen: {
      backgroundColor: "#0c0f14",
      launchAutoHide: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    /**
     * skipNativeAuth: true — plugin returns idToken; we exchange into Better Auth
     * on the chosen origin (WHO-288). Do not create a parallel Firebase session as source of truth.
     */
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com", "apple.com"],
    },
  },
};

export default config;
