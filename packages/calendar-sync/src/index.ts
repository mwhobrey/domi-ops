/**
 * Google Calendar sync engine (v1).
 * Port logic from HomeHub app/google_calendar/* — import-first default,
 * manual pull, optional bidirectional. Worker invokes these jobs.
 */

export type SyncMode = "import_only" | "manual" | "bidirectional";

export type SyncJobName =
  | "google.calendar.pull"
  | "google.calendar.push"
  | "google.calendar.full_import"
  | "recurring.materialize";

export interface SyncJobPayload {
  connectionId: string;
  householdId: string;
  linkedCalendarId?: string;
  userId: string;
}

export { SYNC_QUEUE, enqueueSyncJob, getSyncQueue } from "./queue.js";
export { runCalendarSyncJob, syncConnection, pullLinkedCalendar } from "./sync.js";
export { eventToFields, inferSourceCategory } from "./mapper.js";
export { listGoogleCalendars, ensureAccessToken, CalendarCredentialsError } from "./client.js";

/** Job handlers registered by apps/worker */
export type SyncJobHandler = (payload: SyncJobPayload) => Promise<void>;

const handlers = new Map<SyncJobName, SyncJobHandler>();

export function registerSyncHandler(name: SyncJobName, handler: SyncJobHandler): void {
  handlers.set(name, handler);
}

export async function runSyncJob(
  name: SyncJobName,
  payload: SyncJobPayload,
): Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(
      `No handler for ${name}. Implement in worker (port from HomeHub google_calendar/sync.py).`,
    );
  }
  await handler(payload);
}
