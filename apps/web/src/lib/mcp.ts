export const capabilityLabels: Record<string, string> = {
  "shopping:read": "Read shared household shopping lists and items",
  "chores:read": "Read shared household chores and assignments",
  "notes:read": "Read only the notes you select",
  "shopping:write": "Propose shopping changes; each change needs your review and confirmation in Domi Ops",
  "chores:write": "Propose chore changes; each change needs your review and confirmation in Domi Ops",
  offline_access: "Keep access between visits (until expiry or disconnect)",
};

export type AiConnection = {
  id: string; clientId: string; clientName: string; scopes: string[]; noteIds: string[];
  status: "pending" | "active" | "revoked"; createdAt: string; activatedAt: string | null;
  expiresAt: string; revokedAt: string | null; lastUsedAt: string | null;
  selectedNotes: { id: string; title: string | null }[];
  expired: boolean;
};
export type AiOverview = {
  householdId: string; householdName: string; memberName: string; enabled: boolean; canManage: boolean;
  claude: { connectUrl: string; serverUrl: string } | null;
  chatgpt: { setupUrl: string; serverUrl: string } | null;
  grokBot: { serverUrl: string; scopes: string[] } | null;
  connections: AiConnection[];
};
export type ConsentPreview = {
  householdId: string; householdName: string; memberName: string; clientName: string; clientId: string;
  provider: string; dataMode: string; clientProfileVersion: string; scopes: string[]; policyVersion: string; settingsReviewRequired: boolean;
};

/** Preserve the provider-signed fields; unsigned login navigation must not enter consent. */
export function assistantConsentPath(params: URLSearchParams): string | null {
  if (params.getAll("sig").length !== 1 || !params.getAll("ba_param").length) return null;
  const names = new Set([...params.getAll("ba_param"), "sig", "ba_param"]);
  const signed = new URLSearchParams();
  for (const [key, value] of params) if (names.has(key)) signed.append(key, value);
  return signed.toString().length <= 12000 ? "/ai/consent?" + signed : null;
}

export function assistantLoginRedirect(data: unknown, origin: string): string {
  const value = data as { url?: unknown; redirect_uri?: unknown } | null;
  const target = value?.redirect_uri ?? value?.url;
  if (typeof target !== "string") throw new Error("Restart the connection from your assistant to continue.");
  const url = new URL(target, origin);
  if (url.origin !== origin || url.pathname !== "/ai/consent" || !assistantConsentPath(url.searchParams)) {
    throw new Error("Restart the connection from your assistant to continue.");
  }
  return url.href;
}

export function connectionError(error: unknown): string {
  const value = error as { status?: number; body?: string };
  if (value.status === 404) return "AI connections are not enabled on this deployment. Ask the person who runs your server.";
  if (value.status === 401) return "Your session expired. Sign in again, then restart from your assistant.";
  if (value.status === 409) return "This request expired or the connection changed. Refresh, or restart the connection from your assistant.";
  if (value.body?.includes("provider_settings_review_required")) return "Review your assistant account’s privacy settings before allowing this connection.";
  if (value.body?.includes("mcp_disabled")) return "AI connections are turned off for this household. An owner or admin can enable them in AI connections.";
  if (value.status === 403) return "This connection is not available to your account. Only eligible adult members can approve their own connections.";
  return "Could not complete the request. Refresh before trying again. If approval was interrupted, restart from your assistant.";
}
