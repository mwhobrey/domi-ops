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
  if (scopes.includes("health:read")) parts.push(`Medication group access sends a label you choose, the group's times and whether it was logged. Medication names, strengths, instructions and history are never sent. Timing and logging status are still personal health information.`);
  if (scopes.includes("health:write")) parts.push("Recording a group as taken only fills gaps for medications you approved; it cannot skip, undo or change an entry, and Domi Ops notifies you each time.");
  if (scopes.includes("calendar:read")) parts.push("Calendar availability sends merged busy times for calendars you choose. Event titles, locations, people and calendar names are never sent, and events imported from Google Calendar are left out.");
  return parts.join(" ");
}
