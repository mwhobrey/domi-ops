"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { actionSummary, calendarsChanged, capabilityDetails, capabilityLabels, choicesFromView, connectionError, unapprovedCount, type AiConnection, type AiOverview, type CalendarView, type MedGroupChoice, type MedGroupView } from "../../lib/mcp";
import { MedGroupChoices } from "./MedGroupChoices";
import { CalendarChoices } from "./CalendarChoices";
import { CapabilityChoices } from "./CapabilityChoices";
import { AccountSettingsNav } from "../AccountSettingsNav";
import { ContentSkeleton } from "../ContentSkeleton";
import { ClaudeConnectionSetup } from "./ClaudeConnectionSetup";
import { ChatGptConnectionSetup } from "./ChatGptConnectionSetup";
import { GrokBotConnectionSetup } from "./GrokBotConnectionSetup";
import { Button, Card, CardBody, Checkbox, ConfirmDialog, LocalDateTime } from "../ui";

function Connection({ connection, refresh, report, busy, setBusy }: {
  connection: AiConnection & { householdId: string }; refresh: () => Promise<void>; report: (text: string) => void;
  busy: boolean; setBusy: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [scopes, setScopes] = useState(connection.scopes);
  const [notes, setNotes] = useState(connection.noteIds);
  const [changing, setChanging] = useState(false);
  const [capabilities, setCapabilities] = useState(connection.capabilities);
  const [acknowledged, setAcknowledged] = useState(false);
  const active = connection.status === "active" && !connection.expired;
  const adding = capabilities.filter((name) => !connection.capabilities.includes(name));
  const [groupView, setGroupView] = useState<MedGroupView | null>(null);
  const [medGroups, setMedGroups] = useState<MedGroupChoice[]>([]);
  const [groupsChanged, setGroupsChanged] = useState(false);
  // What is already shared must be on screen before it can be edited: saving replaces the stored selection whole.
  const [groupLoadFailed, setGroupLoadFailed] = useState(false);
  const [calendarLoadFailed, setCalendarLoadFailed] = useState(false);
  // One counter each: retrying one must not reload the other and discard unsaved edits there.
  const [groupReload, setGroupReload] = useState(0);
  const [calendarReload, setCalendarReload] = useState(0);
  const sharesGroups = connection.capabilities.includes("health.groups.read");
  const waiting = unapprovedCount(groupView);
  useEffect(() => {
    if (!active || !sharesGroups) return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await apiClient.post<MedGroupView>(`/api/mcp-auth/connections/${connection.id}/health-groups/view`, {});
        if (!cancelled) { setGroupView(view); setMedGroups(choicesFromView(view)); setGroupLoadFailed(false); }
      } catch { if (!cancelled) setGroupLoadFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [active, sharesGroups, connection.id, groupReload]);
  const [calendarView, setCalendarView] = useState<CalendarView | null>(null);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);
  const sharesCalendars = connection.capabilities.includes("calendar.availability");
  useEffect(() => {
    if (!active || !sharesCalendars) return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await apiClient.post<CalendarView>(`/api/mcp-auth/connections/${connection.id}/calendars/view`, {});
        if (!cancelled) { setCalendarView(view); setCalendarIds(view.calendarIds); setCalendarLoadFailed(false); }
      } catch { if (!cancelled) setCalendarLoadFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [active, sharesCalendars, connection.id, calendarReload]);
  const groupsPending = sharesGroups && !groupView && capabilities.includes("health.groups.read");
  const calendarsPending = sharesCalendars && !calendarView && capabilities.includes("calendar.availability");
  const pendingNotice = (failed: boolean, what: string, retry: () => void) => failed
    ? <div role="alert" className="space-y-2 rounded-xl border border-[var(--color-warning)] p-3 text-sm"><p>The {what} this connection already shares could not be loaded, so they cannot be changed yet. Nothing has been changed.</p><Button type="button" variant="secondary" disabled={busy} onClick={retry}>Try again</Button></div>
    : <p role="status" className="text-sm">Loading the {what} this connection shares…</p>;
  const calendarsEdited = capabilities.includes("calendar.availability") && calendarsChanged(calendarView?.calendarIds ?? [], calendarIds);
  const addingCalendars = calendarsEdited && calendarIds.some((id) => !(calendarView?.calendarIds ?? []).includes(id));
  // Anything that could share more than before goes through the acknowledgment.
  const needsAck = adding.length > 0 || addingCalendars || (capabilities.includes("health.groups.read") && (groupsChanged || waiting > 0));
  async function saveCapabilities(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await apiClient.post(`/api/mcp-auth/connections/${connection.id}/capabilities`, { capabilities, ...(adding.length ? { acknowledged } : {}) });
      if (capabilities.includes("health.groups.read") && (groupsChanged || waiting > 0)) {
        await apiClient.post(`/api/mcp-auth/connections/${connection.id}/health-groups`, { acknowledged,
          groups: medGroups.map((choice) => ({ ...choice, canLog: choice.canLog && capabilities.includes("health.groups.log") })) });
        // Show what is stored now, so an approved medication stops being reported as waiting.
        const view = await apiClient.post<MedGroupView>(`/api/mcp-auth/connections/${connection.id}/health-groups/view`, {});
        setGroupView(view); setMedGroups(choicesFromView(view)); setGroupsChanged(false);
      }
      if (calendarsEdited) {
        await apiClient.post(`/api/mcp-auth/connections/${connection.id}/calendars`, { calendarIds, acknowledged });
        setCalendarView((view) => ({ calendars: view?.calendars ?? [], calendarIds }));
      }
      setChanging(false); report("Access updated. It applies the next time the assistant uses this connection."); await refresh();
    } catch (e) {
      // An earlier step may already be saved, so show what is stored now.
      report(connectionError(e)); await refresh().catch(() => {});
    }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try {
      const result = await apiClient.post<{ providerCleanupComplete: boolean }>(`/api/mcp-auth/connections/${connection.id}/revoke`);
      report(result.providerCleanupComplete ? "Disconnected. Future access is blocked." : "Disconnected locally. Future access is blocked; provider cleanup is still incomplete.");
      setConfirm(false); await refresh();
    } catch (e) { report(connectionError(e)); }
    finally { setBusy(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const result = await apiClient.post<{ revoked: boolean }>(`/api/mcp-auth/connections/${connection.id}/narrow`, { scopes, noteIds: scopes.includes("notes:read") ? notes : [] });
      setEditing(false); report(result.revoked ? "Background access removed and this connection disconnected. Start a new consent to connect again." : "Permissions reduced. The assistant may need to reconnect before it can read again."); await refresh();
    } catch (e) { report(connectionError(e)); }
    finally { setBusy(false); }
  }
  return <Card><CardBody className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">{connection.clientName}</h2><p className="text-sm text-[var(--color-text-muted)]">{active ? "Connected" : connection.status === "revoked" ? "Disconnected" : "Expired or incomplete"}</p></div>
      {connection.status === "active" && <div className="flex flex-wrap gap-2">
        {active && connection.availableCapabilities.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => { setCapabilities(connection.capabilities); setAcknowledged(false); setEditing(false); setGroupsChanged(false); if (groupView) setMedGroups(choicesFromView(groupView)); setCalendarIds(calendarView?.calendarIds ?? []); setChanging(!changing); }}>Change access</Button>}
        {active && <Button variant="secondary" disabled={busy} onClick={() => { setScopes(connection.scopes); setNotes(connection.noteIds); setChanging(false); setEditing(!editing); }}>Remove permissions</Button>}
        <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>Disconnect</Button>
      </div>}
    </div>
    <section className="space-y-1" aria-label="Current access">
      <h3 className="text-sm font-medium">Switched on</h3>
      {connection.capabilities.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{connection.capabilities.map((name) => <li key={name}>{capabilityDetails[name]?.label ?? name}</li>)}</ul>
        : <p className="text-sm text-[var(--color-text-muted)]">Nothing. This assistant can only confirm that it is connected.</p>}
      {connection.capabilities.includes("notes.read") && <p className="text-sm">{connection.noteIds.length} selected notes</p>}
      {sharesGroups && groupView && <p className="text-sm">{groupView.selections.length ? `Medication groups shared as: ${groupView.selections.map((selection) => selection.sharedLabel).join(", ")}` : "No medication groups shared"}</p>}
      {sharesCalendars && calendarView && <p className="text-sm">{calendarView.calendarIds.length ? `Busy times shared from ${calendarView.calendarIds.length} ${calendarView.calendarIds.length === 1 ? "calendar" : "calendars"}` : "No calendars shared"}</p>}
      {active && waiting > 0 && <p role="note" className="rounded-xl border border-[var(--color-warning)] p-3 text-sm">{waiting === 1 ? "1 medication was" : `${waiting} medications were`} added to a shared group since you approved this assistant. It cannot log {waiting === 1 ? "it" : "them"} until you review Change access.</p>}
    </section>
    <dl className="grid gap-2 text-sm text-[var(--color-text-muted)] sm:grid-cols-2">
      <div><dt>Approved</dt><dd><LocalDateTime value={connection.activatedAt ?? connection.createdAt} /></dd></div>
      <div><dt>Expires</dt><dd><LocalDateTime value={connection.expiresAt} /></dd></div>
      <div><dt>Last tool access</dt><dd>{connection.lastUsedAt ? <LocalDateTime value={connection.lastUsedAt} /> : "No activity recorded"}</dd></div>
      {connection.revokedAt && <div><dt>Disconnected</dt><dd><LocalDateTime value={connection.revokedAt} /></dd></div>}
    </dl>
    {connection.recentActions.length > 0 && <section className="space-y-1" aria-label="Recent assistant actions">
      <h3 className="text-sm font-medium">Recent actions by this assistant</h3>
      <ul className="space-y-1 text-sm">{connection.recentActions.map((event, index) => <li key={event.createdAt + index} className="flex flex-wrap justify-between gap-x-4">
        <span>{actionSummary(event)}</span><span className="text-[var(--color-text-muted)]"><LocalDateTime value={event.createdAt} /></span>
      </li>)}</ul>
    </section>}
    {changing && active && <form onSubmit={saveCapabilities} className="space-y-4 border-t border-[var(--color-border)] pt-4">
      <h3 className="font-medium">Change what {connection.clientName} can do</h3>
      <CapabilityChoices idPrefix={connection.id} householdId={connection.householdId} options={connection.availableCapabilities} selected={capabilities} onChange={(next) => { setCapabilities(next); setAcknowledged(false); }} disabled={busy} />
      {groupsPending && pendingNotice(groupLoadFailed, "medication groups", () => setGroupReload((count) => count + 1))}
      {capabilities.includes("health.groups.read") && !groupsPending && <MedGroupChoices idPrefix={connection.id} householdId={connection.householdId} allowLog={capabilities.includes("health.groups.log")}
        value={medGroups} onChange={(next) => { setMedGroups(next); setGroupsChanged(true); setAcknowledged(false); }} disabled={busy}
        isNew={(groupId, medicationId) => groupView?.selections.find((selection) => selection.groupId === groupId)?.medications.find((med) => med.id === medicationId)?.state === "new"} />}
      {calendarsPending && pendingNotice(calendarLoadFailed, "calendars", () => setCalendarReload((count) => count + 1))}
      {capabilities.includes("calendar.availability") && !calendarsPending && <CalendarChoices idPrefix={connection.id} householdId={connection.householdId} value={calendarIds}
        onChange={(next) => { setCalendarIds(next); setAcknowledged(false); }} disabled={busy} />}
      {needsAck && <Checkbox id={connection.id + "-acknowledge"} checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} required disabled={busy}
        label={`I understand I am giving ${connection.clientName} new access, and that what it receives is kept under its provider’s terms.`} />}
      <p className="text-sm text-[var(--color-text-muted)]">Turning something off takes effect immediately. Access this connection was never approved for needs a new connection from your assistant.</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || groupsPending || calendarsPending || (needsAck && !acknowledged)}>Save access</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setChanging(false)}>Cancel</Button></div>
    </form>}
    {editing && active && <form onSubmit={save} className="space-y-4 border-t border-[var(--color-border)] pt-4">
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-3 font-medium">Remove permissions</legend>
        {connection.scopes.map((scope) => <Checkbox key={scope} id={connection.id + scope} label={capabilityLabels[scope] ?? scope} checked={scopes.includes(scope)}
          onChange={(e) => setScopes(e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope))} />)}
        {scopes.includes("notes:read") && connection.noteIds.map((id, index) => <Checkbox key={id} id={connection.id + id}
          label={connection.selectedNotes?.find((n) => n.id === id)?.title ?? `Previously selected note ${index + 1} (no longer available)`}
          checked={notes.includes(id)} onChange={(e) => setNotes(e.target.checked ? [...notes, id] : notes.filter((n) => n !== id))} />)}
      </fieldset>
      <p className="text-sm text-[var(--color-text-muted)]">To add permissions or notes, start a new connection from your assistant and review fresh consent. A disconnected grant stays disconnected.</p>
      {connection.scopes.includes("offline_access") && !scopes.includes("offline_access") && <p className="text-sm">Removing background access disconnects this grant and invalidates its refresh credentials. Start a new consent to connect again.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !scopes.length}>Save reduced access</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>
      {!scopes.length && <p className="text-sm">Use Disconnect to remove all access.</p>}
    </form>}
    <ConfirmDialog open={confirm} title={`Disconnect ${connection.clientName}?`} message="This stops future access. Information already copied to the assistant remains with its provider. Reconnecting requires a new consent."
      confirmLabel="Disconnect" loading={busy} onConfirm={() => void disconnect()} onCancel={() => { if (!busy) setConfirm(false); }} />
  </CardBody></Card>;
}

export function AiConnections() {
  const [data, setData] = useState<AiOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [disable, setDisable] = useState(false);
  async function refresh() {
    if (!data) return;
    setData(await apiClient.post<AiOverview>("/api/mcp-auth/overview", { householdId: data.householdId }));
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await apiClient.get<{ authenticated: boolean; user?: { householdId: string } }>("/auth/session");
        if (!session.authenticated || !session.user) throw { status: 401 };
        const overview = await apiClient.post<AiOverview>("/api/mcp-auth/overview", { householdId: session.user.householdId });
        if (!cancelled) setData(overview);
      } catch (e) { if (!cancelled) setError(connectionError(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  async function toggle(enabled: boolean) {
    if (!data || busy) return;
    setBusy(true); setMessage(null);
    try {
      await apiClient.post("/api/mcp-auth/household", { householdId: data.householdId, enabled });
      setDisable(false); await refresh();
      setMessage(enabled ? "Connections enabled. Each adult member must still approve their own assistant." : "Connections disabled. All household grants are revoked; enabling again will require fresh consent.");
    } catch (e) { setMessage(connectionError(e)); }
    finally { setBusy(false); }
  }
  return <>
    <AccountSettingsNav canManage={data?.canManage ?? false} />
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm text-[var(--color-text-muted)]">Included in your hosted plan and free for self-hosting. You control only your own connections. Household admins cannot see another member’s private grants.</p>
      {loading && <div role="status" aria-label="Loading AI connections"><ContentSkeleton /></div>}
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-[var(--color-border)] p-4 text-sm">{message}</p>}
      {data && <>
        <Card><CardBody className="space-y-3">
          <h2 className="font-semibold">{data.householdName}: {data.enabled ? "enabled" : "turned off"}</h2>
          <p className="text-sm">Connections are personal to {data.memberName}. Enabling this household does not connect anyone or share information.</p>
          {data.canManage ? <Button variant="secondary" disabled={busy} onClick={() => data.enabled ? setDisable(true) : void toggle(true)}>{data.enabled ? "Turn off for household" : "Enable for household"}</Button>
            : <p className="text-sm text-[var(--color-text-muted)]">An owner or admin controls household enablement.</p>}
        </CardBody></Card>
        {data.claude && <ClaudeConnectionSetup enabled={data.enabled} {...data.claude} />}
        {data.chatgpt && <ChatGptConnectionSetup enabled={data.enabled} {...data.chatgpt} />}
        {data.grokBot && <GrokBotConnectionSetup enabled={data.enabled} {...data.grokBot} />}
        <p className="text-sm">Start a connection in an operator-approved assistant, then return here to review or disconnect it. You can switch access on or off within what a connection was approved for. Anything beyond that, and extra notes, needs a new approval from your assistant. Disconnect stops future access; it cannot erase information already copied into an assistant conversation.</p>
        {!data.connections.length && <Card><CardBody>No AI connections yet.</CardBody></Card>}
        {data.connections.map((connection) => <Connection key={connection.id + JSON.stringify(connection.scopes) + connection.noteIds.join() + connection.capabilities.join()} connection={{ ...connection, householdId: data.householdId }} refresh={refresh} report={setMessage} busy={busy} setBusy={setBusy} />)}
        {data.connections.length === 100 && <p className="text-sm">Showing up to 100 recent connections, with active connections first.</p>}
      </>}
      <ConfirmDialog open={disable} title="Turn off all household AI connections?" message="This revokes every member’s grants immediately. Turning connections on again does not restore them. Each person must give fresh consent."
        confirmLabel="Turn off and revoke" loading={busy} onConfirm={() => void toggle(false)} onCancel={() => { if (!busy) setDisable(false); }} />
    </div>
  </>;
}
