import { AppShell } from "../../components/AppShell";
import { CalendarEventPanel } from "../../components/CalendarEventPanel";
import { CalendarWeek, type CalendarEventView } from "../../components/CalendarWeek";
import { SyncCalendarButton } from "../../components/SyncCalendarButton";
import { apiFetch, googleCalendarConnectUrl } from "../../lib/api";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  let status = { enabled: false, oauthConfigured: false, defaultSyncMode: "import_only" };
  let events: CalendarEventView[] = [];
  let connections: { id: string; lastSyncAt: string | null }[] = [];

  try {
    status = await apiFetch("/api/calendar/status");
    const evRes = await apiFetch<{ events: CalendarEventView[] }>(
      `/api/calendar/events?from=${new Date().toISOString().slice(0, 10)}`,
    );
    events = evRes.events.map((e) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      startTime: e.startTime,
      endTime: e.endTime,
      allDay: e.allDay,
      color: e.color,
      calendarId: e.calendarId,
    }));
    const connRes = await apiFetch<{ connections: typeof connections }>("/api/calendar/connections");
    connections = connRes.connections;
  } catch {
    /* API offline */
  }

  return (
    <AppShell title="Calendar">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <a
          href={googleCalendarConnectUrl()}
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-muted)]"
        >
          Connect Google Calendar
        </a>
        <SyncCalendarButton />
        <span className="text-sm text-[var(--color-text-muted)]">
          Mode: {status.defaultSyncMode}
          {connections[0]?.lastSyncAt
            ? ` · Last sync ${new Date(connections[0].lastSyncAt).toLocaleString()}`
            : ""}
        </span>
      </div>
      {params.connected && (
        <p className="mb-4 text-sm text-emerald-400">Google Calendar connected. Initial import queued.</p>
      )}
      {params.error && (
        <p className="mb-4 text-sm text-red-400">Calendar connection failed ({params.error}).</p>
      )}
      <div className="mb-8">
        <CalendarEventPanel initialEvents={events} />
      </div>
      <CalendarWeek events={events} />
    </AppShell>
  );
}
