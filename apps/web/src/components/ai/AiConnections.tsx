"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { capabilityLabels, connectionError, type AiConnection, type AiOverview } from "../../lib/mcp";
import { AccountSettingsNav } from "../AccountSettingsNav";
import { ContentSkeleton } from "../ContentSkeleton";
import { ClaudeConnectionSetup } from "./ClaudeConnectionSetup";
import { Button, Card, CardBody, Checkbox, ConfirmDialog, LocalDateTime } from "../ui";

function Connection({ connection, refresh, report, busy, setBusy }: {
  connection: AiConnection; refresh: () => Promise<void>; report: (text: string) => void;
  busy: boolean; setBusy: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [scopes, setScopes] = useState(connection.scopes);
  const [notes, setNotes] = useState(connection.noteIds);
  const active = connection.status === "active" && !connection.expired;
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
        {active && <Button variant="secondary" disabled={busy} onClick={() => { setScopes(connection.scopes); setNotes(connection.noteIds); setEditing(!editing); }}>Reduce access</Button>}
        <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>Disconnect</Button>
      </div>}
    </div>
    <ul className="list-disc space-y-1 pl-5 text-sm">{connection.scopes.map((scope) => <li key={scope}>{capabilityLabels[scope] ?? scope}</li>)}</ul>
    {connection.scopes.includes("notes:read") && <p className="text-sm">{connection.noteIds.length} selected notes</p>}
    <dl className="grid gap-2 text-sm text-[var(--color-text-muted)] sm:grid-cols-2">
      <div><dt>Approved</dt><dd><LocalDateTime value={connection.activatedAt ?? connection.createdAt} /></dd></div>
      <div><dt>Expires</dt><dd><LocalDateTime value={connection.expiresAt} /></dd></div>
      <div><dt>Last tool access</dt><dd>{connection.lastUsedAt ? <LocalDateTime value={connection.lastUsedAt} /> : "No activity recorded"}</dd></div>
      {connection.revokedAt && <div><dt>Disconnected</dt><dd><LocalDateTime value={connection.revokedAt} /></dd></div>}
    </dl>
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
        <p className="text-sm">Start a connection in an operator-approved assistant, then return here to review or disconnect it. Adding permissions or notes requires a new approval. Disconnect stops future access; it cannot erase information already copied into an assistant conversation.</p>
        {!data.connections.length && <Card><CardBody>No AI connections yet.</CardBody></Card>}
        {data.connections.map((connection) => <Connection key={connection.id + JSON.stringify(connection.scopes) + connection.noteIds.join()} connection={connection} refresh={refresh} report={setMessage} busy={busy} setBusy={setBusy} />)}
        {data.connections.length === 100 && <p className="text-sm">Showing up to 100 recent connections, with active connections first.</p>}
      </>}
      <ConfirmDialog open={disable} title="Turn off all household AI connections?" message="This revokes every member’s grants immediately. Turning connections on again does not restore them. Each person must give fresh consent."
        confirmLabel="Turn off and revoke" loading={busy} onConfirm={() => void toggle(false)} onCancel={() => { if (!busy) setDisable(false); }} />
    </div>
  </>;
}
