/** Scope vocabulary shared by the provider package builders. The server decides what a deployment actually offers. */
export const CORE_READ_SCOPES = ["shopping:read", "chores:read", "notes:read"];
export const PACKAGE_SCOPES = [...CORE_READ_SCOPES, "health:read", "calendar:read", "shopping:write", "health:write"];
/** The hosted update: shopping and chores reads plus every assistant action. Selected notes stay out, as before. */
export const PILOT_SCOPES = ["shopping:read", "chores:read", "shopping:write", "health:read", "health:write", "calendar:read"];

const labels = [
  ["shopping:read", "shared household shopping items"],
  ["chores:read", "shared household chores"],
  ["notes:read", "explicitly selected planning notes"],
  ["shopping:write", "adding shopping items"],
  ["health:read", "medication group times and logging status"],
  ["health:write", "recording a medication group as taken"],
  ["calendar:read", "busy times on chosen calendars"],
];

export function scopeSummary(scopes) {
  return labels.filter(([scope]) => scopes.includes(scope)).map(([, label]) => label).join(", ");
}

/** Anything beyond the original read-only briefing: these need the household actions skill. */
export function hasActions(scopes) {
  return scopes.some(scope => ["shopping:write", "health:read", "health:write", "calendar:read"].includes(scope));
}
export function hasWrites(scopes) { return scopes.some(scope => scope.endsWith(":write")); }
export function hasHealth(scopes) { return scopes.some(scope => scope.startsWith("health:")); }

const sentenceList = (items) => items.length < 3 ? items.join(" and ") : items.slice(0, -1).join(", ") + " and " + items.at(-1);
/** Which reads a new connection starts with, for the scopes this package actually requests. */
export function readsOnSentence(scopes) {
  const reads = [scopes.includes("shopping:read") ? "shopping" : null, scopes.includes("chores:read") ? "chores" : null, scopes.includes("notes:read") ? "selected notes" : null].filter(Boolean);
  return reads.length ? `Reading ${sentenceList(reads)} starts on; everything else starts off` : "Every ability starts off";
}
/** The tools that are not read-only, for the scopes this package actually requests. */
export function writeToolsSentence(scopes) {
  const tools = [scopes.includes("shopping:write") ? "adding a shopping item" : null, scopes.includes("health:write") ? "recording a medication group as taken" : null].filter(Boolean);
  if (!tools.length) return "Every tool is read-only.";
  return tools.length === 1
    ? `One tool is not read-only: ${tools[0]}. It is additive, safe to repeat and cannot edit, remove, skip or undo anything.`
    : `Two tools are not read-only: ${tools.join(" and ")}. Both are additive, safe to repeat and cannot edit, remove, skip or undo anything.`;
}
/** What is held back, for the scopes this package actually requests. */
export function withheldSentence(scopes) {
  return [hasHealth(scopes) ? "Medication name, strength, instruction and history fields are never sent; a group's label is sent as the member wrote it." : null,
    scopes.includes("calendar:read") ? "Event titles, locations, people and calendar names are never sent." : null].filter(Boolean).join(" ");
}

/** A package must ask for at least one read, and never for an action whose read it leaves out. */
export function checkPackageScopes(scopes, allowed = PACKAGE_SCOPES) {
  if (!Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !allowed.includes(scope)) ||
      !scopes.some(scope => scope.endsWith(":read")) || (scopes.includes("health:write") && !scopes.includes("health:read")) ||
      (scopes.includes("shopping:write") && !scopes.includes("shopping:read"))) throw new Error("Explicit supported scopes required: " + allowed.join(","));
  return scopes;
}

export function skillNames(scopes) {
  return ["domi-ops-household-briefing", ...(hasActions(scopes) ? ["domi-ops-household-actions"] : [])];
}

/** One paragraph, shared by every package README, on what leaves Domi Ops for the requested scopes. */
export function privacyParagraph(scopes, assistant) {
  const parts = [];
  if (scopes.includes("shopping:read") || scopes.includes("chores:read")) parts.push(`Approved reads send household labels/timezone and ${[scopes.includes("chores:read") ? "chores" : null, scopes.includes("shopping:read") ? "shopping items" : null].filter(Boolean).join(" and ")} to ${assistant}.`);
  if (scopes.includes("notes:read")) parts.push("Selected-note access sends only the notes you pick.");
  if (scopes.includes("shopping:write")) parts.push("Adding a shopping item sends back the item you asked for; it cannot edit, check off or remove one.");
  if (scopes.includes("health:read")) parts.push(`Medication group access sends a label you choose, the group's times and whether it was logged. Medication name, strength, instruction and history fields are never sent, but the label is sent as you wrote it, so choose one that does not name a medication. Timing and logging status are still personal health information.`);
  if (scopes.includes("health:write")) parts.push("Recording a group as taken only fills gaps for medications you approved; it cannot skip, undo or change an entry, and Domi Ops notifies you each time.");
  if (scopes.includes("calendar:read")) parts.push("Calendar availability sends merged busy times for calendars you choose. Event titles, locations, people and calendar names are never sent, and events imported from Google Calendar are left out.");
  return parts.join(" ");
}
