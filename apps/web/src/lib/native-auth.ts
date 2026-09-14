import { apiClient } from "./client-api";
import { getCapacitorPlugin, getCapacitor } from "./capacitor-bridge";
import { isNativeShell, nativePlatform } from "./native-shell";

type FirebaseAuthPlugin = {
  signInWithGoogle: (options?: { skipNativeAuth?: boolean }) => Promise<{
    credential?: { idToken?: string | null; accessToken?: string | null };
  }>;
  signInWithApple: (options?: { skipNativeAuth?: boolean }) => Promise<{
    credential?: { idToken?: string | null; accessToken?: string | null };
  }>;
};

/** True when native social plugins are present (Capacitor Firebase Authentication). */
export function isNativeSocialAuthAvailable(): boolean {
  if (!isNativeShell()) return false;
  return Boolean(getCapacitorPlugin("FirebaseAuthentication"));
}

/**
 * Native Google / Apple → POST /api/core/native-auth/social (WHO-288).
 * Uses skipNativeAuth so the idToken is exchanged into Better Auth on the chosen origin.
 */
export async function signInWithNativeSocial(
  provider: "google" | "apple",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isNativeShell()) {
    return { ok: false, error: "not_native" };
  }
  if (provider === "apple" && nativePlatform() !== "ios") {
    return { ok: false, error: "apple_ios_only" };
  }

  const plugin = getCapacitorPlugin<FirebaseAuthPlugin>("FirebaseAuthentication");
  if (!plugin) {
    return {
      ok: false,
      error:
        "Native auth plugin missing. Rebuild the store shell with @capacitor-firebase/authentication.",
    };
  }

  try {
    const result =
      provider === "google"
        ? await plugin.signInWithGoogle({ skipNativeAuth: true })
        : await plugin.signInWithApple({ skipNativeAuth: true });
    const idToken = result.credential?.idToken?.trim();
    if (!idToken) {
      return { ok: false, error: "missing_id_token" };
    }
    const accessToken = result.credential?.accessToken?.trim() || undefined;
    await apiClient.post("/api/core/native-auth/social", {
      provider,
      idToken,
      ...(accessToken ? { accessToken } : {}),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_auth_failed";
    console.warn("[domi-ops native-auth]", provider, msg);
    return { ok: false, error: msg };
  }
}

/** Best-effort: expose whether SIWA should show (iOS native + Google offered). */
export function shouldOfferNativeApple(googleEnabled: boolean): boolean {
  return googleEnabled && isNativeShell() && nativePlatform() === "ios";
}

export function capacitorPlatformLabel(): string {
  return getCapacitor()?.getPlatform?.() ?? "web";
}
