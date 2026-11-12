export const capabilityLabels: Record<string, string> = {
  "shopping:read": "Read shared household shopping lists and items",
  "chores:read": "Read shared household chores and assignments",
  "notes:read": "Read only the notes you select",
  "shopping:write": "Shopping changes, limited to the actions you switch on or confirm in Domi Ops",
  "chores:write": "Chore changes, limited to the actions you switch on or confirm in Domi Ops",
  "health:read": "Medication group times and logging status, limited to the groups you choose",
  "health:write": "Recording a medication group as taken, limited to the groups you allow",
  "calendar:read": "When you are busy, limited to the calendars you choose. Never event details",
  offline_access: "Keep access between visits (until expiry or disconnect)",
};

/** What a member switches on for one connection. The scope above is only the outer bound. */
export const capabilityDetails: Record<string, { label: string; detail: string }> = {
  "shopping.read": { label: "Read the shared shopping list", detail: "Item names, quantities, units, aisles and checked state. No costs, receipts or item notes." },
  "chores.read": { label: "Read shared chores", detail: "The first line of each chore, its due date, whether it is done and who it is assigned to. Children are shown as “Household member”." },
  "notes.read": { label: "Read only the notes you select", detail: "The title and text of each note you pick below. Notes with links or embeds share their title only." },
  "shopping.add": { label: "Add items to the shared shopping list", detail: "The assistant can add an item when you ask in chat, with no confirmation step in Domi Ops. It cannot edit, check off or remove items. Everyone in your household sees what it adds." },
};
capabilityDetails["health.groups.read"] = { label: "See when my medication groups are due", detail: "For the groups you pick below: a label, the times and whether each has been logged. Never a medication name, strength, instruction or history. Timing and logging status are still personal information." };
capabilityDetails["health.groups.log"] = { label: "Record a medication group as taken", detail: "When you tell the assistant you took a group, it records that for the medications you approved, with no confirmation step in Domi Ops. It cannot skip, undo or change an entry. You get a notice in Domi Ops each time." };
capabilityDetails["calendar.availability"] = { label: "See when I am busy", detail: "For the calendars you pick below: the times you are busy, merged into blocks. Never an event title, location, person or calendar name. Events imported from Google Calendar are left out. When you are busy is still personal information." };
export type OwnCalendar = { id: string; name: string; visibility: "household" | "private" };
export type CalendarView = { calendars: OwnCalendar[]; calendarIds: string[] };
/** True when the two selections differ, whatever their order. */
export function calendarsChanged(before: readonly string[], after: readonly string[]): boolean {
  return before.length !== after.length || after.some((id) => !before.includes(id));
}
export type MedGroupChoice = { groupId: string; canLog: boolean; shareCounts: boolean; alias: string | null; excludedMedicationIds: string[] };
export type OwnMedGroup = { id: string; name: string; enabled: boolean; times: string[]; medications: { id: string; name: string; paused: boolean }[] };
export type MedGroupView = { groups: OwnMedGroup[]; selections: { groupId: string; canLog: boolean; shareCounts: boolean; alias: string | null; sharedLabel: string; medications: { id: string; state: "approved" | "excluded" | "new" }[] }[] };
/** Stored selections as editable choices. A medication added since approval starts ticked, so saving approves it. */
export function choicesFromView(view: MedGroupView): MedGroupChoice[] {
  return view.selections.map((selection) => ({ groupId: selection.groupId, canLog: selection.canLog, shareCounts: selection.shareCounts, alias: selection.alias,
    excludedMedicationIds: selection.medications.filter((med) => med.state === "excluded").map((med) => med.id) }));
}
export function unapprovedCount(view: MedGroupView | null): number {
  return view ? view.selections.reduce((total, selection) => total + selection.medications.filter((med) => med.state === "new").length, 0) : 0;
}
export type CapabilityOption = { name: string; access: "read" | "write" };
export type AiAction = { action: string; outcome: string; counts: Record<string, number> | null; createdAt: string };

const actionOutcomes: Record<string, Record<string, string>> = {
  "shopping.add": { added: "Added a shopping item", already_on_list: "Asked to add an item that was already on the list" },
};
/** Activity rows hold outcome classes and counts only, so this never shows what was added or which group. */
export function actionSummary(event: Pick<AiAction, "action" | "outcome"> & { counts?: Record<string, number> | null }): string {
  if (event.action === "health.groups.log") {
    const logged = event.counts?.logged ?? 0, blocked = event.counts?.notAccessible ?? 0;
    const doses = (count: number) => `${count} ${count === 1 ? "dose" : "doses"}`;
    if (event.outcome === "logged") return `Recorded a medication group as taken (${doses(logged)}${blocked ? `, ${blocked} not recorded: no access` : ""})`;
    if (event.outcome === "nothing_to_log") return "Asked to record a medication group that was already recorded";
    if (event.outcome === "not_permitted") return "Asked to record a medication group it has no access to log";
    if (event.outcome === "target_changed") return "Asked to record a medication group using a reference that was no longer valid; nothing was recorded";
  }
  return actionOutcomes[event.action]?.[event.outcome] ?? "Completed an action";
}
/** Requested household reads start selected. An action never does, and neither does anything about health or a calendar. */
export function defaultCapabilities(options: readonly CapabilityOption[]): string[] {
  return options.filter((option) => option.access === "read" && !option.name.startsWith("health.") && !option.name.startsWith("calendar.")).map((option) => option.name);
}

export type AiConnection = {
  id: string; clientId: string; clientName: string; scopes: string[]; noteIds: string[];
  status: "pending" | "active" | "revoked"; createdAt: string; activatedAt: string | null;
  expiresAt: string; revokedAt: string | null; lastUsedAt: string | null;
  selectedNotes: { id: string; title: string | null }[];
  expired: boolean;
  capabilities: string[]; availableCapabilities: CapabilityOption[]; recentActions: AiAction[];
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
  availableCapabilities: CapabilityOption[];
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
  if (value.body?.includes("invalid_calendar_selection")) return "Those calendars could not be shared. Refresh and choose again.";
  if (value.body?.includes("invalid_group_selection")) return "Those medication groups could not be shared. Refresh and choose again.";
  if (value.body?.includes("acknowledgment_required")) return "Confirm that you understand the new access before saving.";
  if (value.body?.includes("invalid_capability")) return "That access is not available for this connection. Refresh, or start a new connection from your assistant.";
  if (value.body?.includes("mcp_disabled")) return "AI connections are turned off for this household. An owner or admin can enable them in AI connections.";
  if (value.status === 403) return "This connection is not available to your account. Only eligible adult members can approve their own connections.";
  return "Could not complete the request. Refresh before trying again. If approval was interrupted, restart from your assistant.";
}
