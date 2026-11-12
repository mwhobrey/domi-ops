import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  healthMedicationGroupMembers, healthMedicationGroups, healthMedicationLogs, healthMedications, households,
  mcpMedGroupMemberConsents, mcpMedGroupSelections, pushSubscriptions, users, type Database,
} from "@domi-ops/db";
import { addDaysIso, deliverUserNotificationToSubscriptions, expandScheduledSlots, parseFixedTimeSchedule, persistUserNotificationOnce, todayIsoDateInTz } from "@domi-ops/calendar-sync";
import { McpAuthorizationError, type McpOwnedConnection } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import { decryptHealthFieldOrPassthrough, encryptHealthField } from "../lib/health-crypto.js";
import { recordDose } from "../lib/health-med-logging.js";
import { McpGatewayError } from "./access.js";

/**
 * Assistant access to medication groups. The assistant gets a label, times and a logging status.
 * It never gets a medication name, strength, instruction or history, and it names what to log
 * with an opaque reference that this module resolves under current permissions.
 *
 * Pilot bounds: the connection member's own groups only, fixed-time ("scheduled") groups only.
 */
type Owner = { householdId: string; memberId: string };
type GroupRow = typeof healthMedicationGroups.$inferSelect;
type MedRow = typeof healthMedications.$inferSelect;
export type OccurrenceStatus = "pending" | "taken" | "partly_taken" | "skipped" | "mixed";
export type GroupDay = "today" | "yesterday" | "tomorrow";
/** One shared group as a tool sees it. `approved` holds medication ids and never leaves the server. */
export type SharedGroup = { groupId: string; label: string; canLog: boolean; shareCounts: boolean; approved: ReadonlySet<string> };
export type GroupChoice = { groupId: string; canLog: boolean; shareCounts: boolean; alias?: string | null; excludedMedicationIds: string[] };

const LABEL_LENGTH = 40;
/** One line of plain text: no control characters, line separators or direction overrides. */
export function cleanLabel(value: string): string {
  let text = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    text += code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) ? " " : character;
  }
  text = text.trim().replace(/\s+/g, " ");
  const cut = [...text].slice(0, LABEL_LENGTH).join("").trim();
  return cut || "Medication group";
}

function scheduleDigest(group: GroupRow) {
  const schedule = parseFixedTimeSchedule(group.scheduleJson);
  return createHash("sha256").update(JSON.stringify([schedule.times ?? [], schedule.daysOfWeek ?? [], group.startDate, group.endDate, group.enabled])).digest("hex").slice(0, 16);
}

type Reference = { g: string; d: string; t: string; s: string };
/** Signed, connection-bound names for "this group at this time on this date". Possession grants nothing. */
export function occurrenceReferences(secret: string | undefined) {
  let key: Buffer | undefined;
  const signingKey = () => {
    if (!secret) throw new McpGatewayError("temporarily_unavailable", 503);
    return key ??= createHmac("sha256", secret).update("domi-ops/mcp/med-occurrence/v1").digest();
  };
  const mac = (connectionId: string, payload: string) => createHmac("sha256", signingKey()).update(connectionId).update("\0").update(payload).digest();
  return {
    encode(connectionId: string, value: Reference) {
      const payload = Buffer.from(JSON.stringify({ ...value, x: Date.now() + 36 * 3600_000 })).toString("base64url");
      return payload + "." + mac(connectionId, payload).toString("base64url");
    },
    /** Null for anything unsigned, altered, expired or issued to another connection. */
    decode(connectionId: string, reference: string): Reference | null {
      signingKey();
      try {
        const [payload, signature, extra] = reference.split(".");
        const expected = mac(connectionId, payload), actual = Buffer.from(signature, "base64url");
        if (extra !== undefined || actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null;
        const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Reference & { x: number };
        if (!Number.isFinite(value.x) || value.x < Date.now()) return null;
        if (typeof value.g !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.d) || !/^\d{2}:\d{2}$/.test(value.t) || typeof value.s !== "string") return null;
        return { g: value.g, d: value.d, t: value.t, s: value.s };
      } catch { return null; }
    },
  };
}

async function timezone(tx: Database, householdId: string) {
  const [household] = await tx.select({ timezone: households.timezone }).from(households).where(eq(households.id, householdId));
  return household?.timezone ?? "UTC";
}

/** The member's own fixed-time groups. Other members' groups are out of scope, whatever sharing exists. */
async function ownGroups(tx: Database, owner: Owner, ids?: readonly string[]) {
  if (ids && !ids.length) return [];
  return tx.select().from(healthMedicationGroups).where(and(
    eq(healthMedicationGroups.householdId, owner.householdId), eq(healthMedicationGroups.memberId, owner.memberId),
    eq(healthMedicationGroups.scheduleKind, "scheduled"), ids ? inArray(healthMedicationGroups.id, [...ids]) : undefined));
}

/** Current member medications per group: the member's own, not deleted. Paused ones are included and flagged by `enabled`. */
async function membersOf(tx: Database, owner: Owner, groupIds: readonly string[]) {
  const byGroup = new Map<string, MedRow[]>();
  if (!groupIds.length) return byGroup;
  const rows = await tx.select({ groupId: healthMedicationGroupMembers.groupId, med: healthMedications }).from(healthMedicationGroupMembers)
    .innerJoin(healthMedications, eq(healthMedications.id, healthMedicationGroupMembers.medicationId))
    .where(and(inArray(healthMedicationGroupMembers.groupId, [...groupIds]), eq(healthMedications.householdId, owner.householdId),
      eq(healthMedications.memberId, owner.memberId), isNull(healthMedications.deletedAt)));
  for (const row of rows) byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), row.med]);
  return byGroup;
}

/** For the member's own browser only: their groups and medication names, to choose what to share. */
export async function listOwnGroups(tx: Database, env: Env, owner: Owner) {
  const groups = await ownGroups(tx, owner), members = await membersOf(tx, owner, groups.map((group) => group.id));
  return groups.map((group) => ({
    id: group.id, name: decryptHealthFieldOrPassthrough(group.name, env) ?? "", enabled: group.enabled,
    times: (parseFixedTimeSchedule(group.scheduleJson).times ?? []).map((time) => time.slice(0, 5)),
    medications: (members.get(group.id) ?? []).map((med) => ({ id: med.id, name: decryptHealthFieldOrPassthrough(med.name, env) ?? "", paused: !med.enabled })),
  })).sort((a, b) => (a.times[0] ?? "").localeCompare(b.times[0] ?? "") || a.name.localeCompare(b.name));
}

type StoredSelection = { groupId: string; canLog: boolean; shareCounts: boolean; alias: string | null; states: Map<string, "approved" | "excluded"> };
async function storedSelections(tx: Database, env: Env, connectionId: string): Promise<StoredSelection[]> {
  const rows = await tx.select().from(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, connectionId));
  const consents = rows.length ? await tx.select().from(mcpMedGroupMemberConsents).where(eq(mcpMedGroupMemberConsents.connectionId, connectionId)) : [];
  return rows.map((row) => ({ groupId: row.groupId, canLog: row.canLog, shareCounts: row.shareCounts, alias: decryptHealthFieldOrPassthrough(row.labelAlias, env),
    states: new Map(consents.filter((consent) => consent.groupId === row.groupId).map((consent) => [consent.medicationId, consent.state])) }));
}

/** For the member's own browser: what this connection may see, including medications added since approval. */
export async function viewGroupSelections(tx: Database, env: Env, connection: McpOwnedConnection) {
  const groups = await listOwnGroups(tx, env, connection), stored = await storedSelections(tx, env, connection.connectionId);
  return { groups, selections: stored.filter((selection) => groups.some((group) => group.id === selection.groupId)).map((selection) => {
    const group = groups.find((entry) => entry.id === selection.groupId)!;
    return { groupId: selection.groupId, canLog: selection.canLog, shareCounts: selection.shareCounts, alias: selection.alias, sharedLabel: cleanLabel(selection.alias ?? group.name),
      medications: group.medications.map((med) => ({ id: med.id, state: selection.states.get(med.id) ?? "new" as const })) };
  }) };
}

/**
 * Replace which groups a connection may see. Saving approves every current member medication that is
 * not excluded, which is how newly added medications get approved in one step. Anything that shares
 * more than before needs the member's explicit acknowledgment.
 */
export async function saveGroupSelections(tx: Database, env: Env, connection: McpOwnedConnection, choices: readonly GroupChoice[], acknowledged: boolean) {
  const invalid = (): never => { throw new McpAuthorizationError("invalid_group_selection", 400); };
  if (choices.length && !connection.capabilities.includes("health.groups.read")) invalid();
  if (choices.some((choice) => choice.canLog) && !connection.capabilities.includes("health.groups.log")) invalid();
  if (choices.length > 50 || new Set(choices.map((choice) => choice.groupId)).size !== choices.length) invalid();
  const groups = await ownGroups(tx, connection, choices.map((choice) => choice.groupId));
  if (groups.length !== choices.length) invalid();
  const members = await membersOf(tx, connection, groups.map((group) => group.id));
  const previous = new Map((await storedSelections(tx, env, connection.connectionId)).map((selection) => [selection.groupId, selection]));
  let widened = false;
  const planned = choices.map((choice) => {
    const alias = choice.alias?.trim() ? cleanLabel(choice.alias) : null, before = previous.get(choice.groupId);
    const current = (members.get(choice.groupId) ?? []).map((med) => med.id);
    if (choice.excludedMedicationIds.some((id) => !current.includes(id))) invalid();
    const states = current.map((medicationId) => ({ medicationId, state: choice.excludedMedicationIds.includes(medicationId) ? "excluded" as const : "approved" as const }));
    if (!before || (choice.canLog && !before.canLog) || (choice.shareCounts && !before.shareCounts) || alias !== before.alias ||
      states.some((entry) => entry.state === "approved" && before.states.get(entry.medicationId) !== "approved")) widened = true;
    return { choice, alias, states };
  });
  if (widened && !acknowledged) throw new McpAuthorizationError("acknowledgment_required", 400);
  // Member consents go with their selection through the cascade.
  await tx.delete(mcpMedGroupSelections).where(eq(mcpMedGroupSelections.connectionId, connection.connectionId));
  const owned = { householdId: connection.householdId, connectionId: connection.connectionId, userId: connection.userId };
  for (const { choice, alias, states } of planned) {
    await tx.insert(mcpMedGroupSelections).values({ ...owned, groupId: choice.groupId, canLog: choice.canLog, shareCounts: choice.shareCounts, labelAlias: alias ? encryptHealthField(alias, env) : null });
    if (states.length) await tx.insert(mcpMedGroupMemberConsents).values(states.map((entry) => ({ ...owned, groupId: choice.groupId, ...entry })));
  }
  return { groups: planned.length, widened };
}

/** What the tools may use for a live connection, or for a preview of choices not yet saved. */
export async function sharedGroups(tx: Database, env: Env, owner: Owner, connectionId: string): Promise<SharedGroup[]> {
  const stored = await storedSelections(tx, env, connectionId);
  const groups = await ownGroups(tx, owner, stored.map((selection) => selection.groupId));
  return stored.flatMap((selection) => {
    const group = groups.find((entry) => entry.id === selection.groupId);
    if (!group) return [];
    return [{ groupId: selection.groupId, canLog: selection.canLog, shareCounts: selection.shareCounts,
      label: cleanLabel(selection.alias ?? decryptHealthFieldOrPassthrough(group.name, env) ?? ""),
      approved: new Set([...selection.states].filter(([, state]) => state === "approved").map(([id]) => id)) }];
  });
}
export async function proposedGroups(tx: Database, env: Env, owner: Owner, choices: readonly GroupChoice[]): Promise<SharedGroup[]> {
  const groups = await ownGroups(tx, owner, choices.map((choice) => choice.groupId)), members = await membersOf(tx, owner, groups.map((group) => group.id));
  return choices.flatMap((choice) => {
    const group = groups.find((entry) => entry.id === choice.groupId);
    if (!group) return [];
    return [{ groupId: choice.groupId, canLog: choice.canLog, shareCounts: choice.shareCounts,
      label: cleanLabel(choice.alias?.trim() ? choice.alias : decryptHealthFieldOrPassthrough(group.name, env) ?? ""),
      approved: new Set((members.get(choice.groupId) ?? []).map((med) => med.id).filter((id) => !choice.excludedMedicationIds.includes(id))) }];
  });
}

/** Medications due in a group's occurrence: enabled members whose own schedule lands on that exact instant. */
function dueMedications(meds: readonly MedRow[], date: string, at: Date, timeZone: string) {
  return meds.filter((med) => {
    if (!med.enabled || med.scheduleKind !== "scheduled") return false;
    const schedule = parseFixedTimeSchedule(med.scheduleJson);
    return expandScheduledSlots({ times: schedule.times, daysOfWeek: schedule.daysOfWeek, startDate: med.startDate, endDate: med.endDate, dates: [date], timeZone })
      .some((slot) => slot.scheduledAt.getTime() === at.getTime());
  });
}
function groupSlots(group: GroupRow, date: string, timeZone: string) {
  if (!group.enabled) return [];
  const schedule = parseFixedTimeSchedule(group.scheduleJson);
  return expandScheduledSlots({ times: schedule.times, daysOfWeek: schedule.daysOfWeek, startDate: group.startDate, endDate: group.endDate, dates: [date], timeZone });
}
async function logsAt(tx: Database, medicationIds: readonly string[], instants: readonly Date[]) {
  if (!medicationIds.length || !instants.length) return [];
  return tx.select({ medicationId: healthMedicationLogs.medicationId, scheduledAt: healthMedicationLogs.scheduledAt, status: healthMedicationLogs.status })
    .from(healthMedicationLogs).where(and(inArray(healthMedicationLogs.medicationId, [...medicationIds]), inArray(healthMedicationLogs.scheduledAt, [...instants])));
}
function summarize(statuses: readonly (string | undefined)[]): OccurrenceStatus {
  const taken = statuses.filter((status) => status === "taken").length, declined = statuses.filter((status) => status === "skipped" || status === "missed").length;
  if (taken === statuses.length) return "taken";
  if (declined === statuses.length) return "skipped";
  if (taken + declined === 0) return "pending";
  return declined === 0 ? "partly_taken" : "mixed";
}
function dateFor(day: GroupDay, timeZone: string) {
  const today = todayIsoDateInTz(timeZone);
  return day === "today" ? today : addDaysIso(today, day === "yesterday" ? -1 : 1);
}

/** The whole of what an assistant can read about medication: labels, local times and a status per occurrence. */
export async function groupSchedule(tx: Database, owner: Owner, shared: readonly SharedGroup[], day: GroupDay, reference: (value: Reference) => string) {
  const timeZone = await timezone(tx, owner.householdId), date = dateFor(day, timeZone);
  const groups = await ownGroups(tx, owner, shared.map((entry) => entry.groupId)), members = await membersOf(tx, owner, groups.map((group) => group.id));
  const planned = shared.flatMap((entry) => {
    const group = groups.find((candidate) => candidate.id === entry.groupId);
    if (!group) return [];
    const occurrences = groupSlots(group, date, timeZone).map((slot) => ({ slot, due: dueMedications(members.get(group.id) ?? [], date, slot.scheduledAt, timeZone) })).filter((occurrence) => occurrence.due.length);
    return [{ entry, group, occurrences }];
  });
  const logs = await logsAt(tx, [...new Set(planned.flatMap((plan) => plan.occurrences.flatMap((occurrence) => occurrence.due.map((med) => med.id))))],
    planned.flatMap((plan) => plan.occurrences.map((occurrence) => occurrence.slot.scheduledAt)));
  const data = planned.map(({ entry, group, occurrences }) => ({
    label: entry.label, canLog: entry.canLog,
    occurrences: occurrences.sort((a, b) => a.slot.scheduledAt.getTime() - b.slot.scheduledAt.getTime()).map(({ slot, due }) => ({
      occurrenceRef: reference({ g: group.id, d: date, t: slot.hhmm, s: scheduleDigest(group) }), localTime: slot.hhmm,
      // Status describes the group as its member knows it, including medications this assistant cannot log.
      status: summarize(due.map((med) => logs.find((log) => log.medicationId === med.id && log.scheduledAt?.getTime() === slot.scheduledAt.getTime())?.status)),
      ...(entry.shareCounts ? { total: due.length, notAccessibleToAssistant: due.filter((med) => !entry.approved.has(med.id)).length } : {}),
    })),
  }));
  // Earliest first, so "morning" comes before "night" whatever order the rows were stored in.
  data.sort((a, b) => (a.occurrences[0]?.localTime ?? "99").localeCompare(b.occurrences[0]?.localTime ?? "99") || a.label.localeCompare(b.label));
  return { date, timeZone, data };
}

export type DoseNotice = { userId: string; householdId: string; title: string; body: string; url: string; tag: string };
/**
 * Push the notice the member already has in their inbox. Honors their existing health-reminder
 * push preference; the in-app notice is written regardless. Run after the action has committed.
 */
export async function pushDoseNotice(tx: Database, env: Env, notice: DoseNotice) {
  const [user] = await tx.select({ enabled: users.pushHealthRemindersEnabled }).from(users).where(eq(users.id, notice.userId));
  if (!user?.enabled) return;
  const subscriptions = await tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, notice.userId));
  if (subscriptions.length) await deliverUserNotificationToSubscriptions(tx, env, { ...notice, subscriptions });
}

export type GroupLogOutcome = "logged" | "nothing_to_log" | "not_permitted" | "target_changed";
type LogIdentity = Owner & { userId: string; connectionId: string; clientName: string };
/**
 * Record a shared group's occurrence as taken for the medications this connection is approved for.
 * It only fills gaps: an existing entry, including a deliberate skip, is left as it is. Everything
 * happens in the caller's transaction, so a failure saves nothing.
 */
export async function logGroupOccurrence(tx: Database, env: Env, identity: LogIdentity, target: Reference | null) {
  const changed = { outcome: "target_changed" as GroupLogOutcome, label: null, date: null, localTime: null, logged: 0, alreadyRecorded: 0, notAccessible: 0, shareCounts: false, groupId: null as string | null, notice: null as DoseNotice | null };
  if (!target) return changed;
  const entry = (await sharedGroups(tx, env, identity, identity.connectionId)).find((candidate) => candidate.groupId === target.g);
  // An unshared or foreign group is indistinguishable from a reference that no longer resolves.
  if (!entry) return changed;
  const base = { label: entry.label, date: target.d, localTime: target.t, shareCounts: entry.shareCounts, groupId: entry.groupId };
  if (!entry.canLog) return { ...changed, ...base, outcome: "not_permitted" as GroupLogOutcome };
  const timeZone = await timezone(tx, identity.householdId), today = todayIsoDateInTz(timeZone);
  const [group] = await tx.select().from(healthMedicationGroups).where(and(eq(healthMedicationGroups.id, entry.groupId), eq(healthMedicationGroups.householdId, identity.householdId),
    eq(healthMedicationGroups.memberId, identity.memberId), eq(healthMedicationGroups.scheduleKind, "scheduled"))).for("share");
  const slot = group && scheduleDigest(group) === target.s ? groupSlots(group, target.d, timeZone).find((candidate) => candidate.hhmm === target.t) : undefined;
  // Only today and yesterday: no rewriting history, no logging ahead.
  if (!group || !slot || (target.d !== today && target.d !== addDaysIso(today, -1))) return { ...changed, ...base };
  const due = dueMedications((await membersOf(tx, identity, [group.id])).get(group.id) ?? [], target.d, slot.scheduledAt, timeZone);
  const permitted = due.filter((med) => entry.approved.has(med.id)), notAccessible = due.length - permitted.length;
  let logged = 0, alreadyRecorded = 0;
  const loggedAt = new Date();
  for (const med of permitted) {
    const { outcome } = await recordDose(tx, env, { med, householdId: identity.householdId, loggedByUserId: identity.userId, status: "taken", scheduledAt: slot.scheduledAt,
      loggedAt, source: "bulk", alsoCreateEvent: false, loggedViaConnectionId: identity.connectionId });
    if (outcome === "inserted") logged++; else alreadyRecorded++;
  }
  let notice: DoseNotice | null = null;
  if (logged) {
    // A false "taken" could lead someone to miss a real dose, so the member is always told in the app.
    // No label, time or count here: this table is not encrypted health storage, and a push may show on a lock screen.
    notice = { userId: identity.userId, householdId: identity.householdId, title: `${cleanLabel(identity.clientName)} recorded medication as taken`,
      body: "An assistant you connected recorded a medication group as taken at your request. If that is not right, correct it in Health.", url: "/health",
      tag: `mcp-med:${identity.connectionId}:${group.id}:${slot.scheduledAt.getTime()}`.slice(0, 128) };
    await persistUserNotificationOnce(tx, notice);
  }
  const outcome: GroupLogOutcome = logged ? "logged" : permitted.length ? "nothing_to_log" : due.length ? "not_permitted" : "nothing_to_log";
  return { ...base, outcome, logged, alreadyRecorded, notAccessible, notice };
}
