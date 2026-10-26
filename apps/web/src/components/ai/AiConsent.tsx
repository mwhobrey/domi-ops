"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { capabilityLabels, connectionError, type ConsentPreview } from "../../lib/mcp";
import { Button, Card, CardBody, Checkbox } from "../ui";
import { ContentSkeleton } from "../ContentSkeleton";
import { NoteConsentPicker } from "./NoteConsentPicker";
import { ProviderDataDisclosure } from "./ProviderDataDisclosure";

export function AiConsent() {
  const [preview, setPreview] = useState<ConsentPreview | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [adult, setAdult] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [settingsReviewed, setSettingsReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const oauthQuery = window.location.search.slice(1);
    void (async () => {
      try {
        const session = await apiClient.get<{ authenticated: boolean; user?: { householdId: string } }>("/auth/session");
        if (!session.authenticated || !session.user) throw { status: 401 };
        const value = await apiClient.post<ConsentPreview>("/api/mcp-auth/consents/preview", { householdId: session.user.householdId, oauthQuery });
        if (!cancelled) { setQuery(oauthQuery); setPreview(value); }
      } catch (e) { if (!cancelled) setError(connectionError(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!preview || busy || attempted || !adult || !privacy || (preview.settingsReviewRequired && !settingsReviewed)) return;
    setBusy(true); setAttempted(true); setError(null);
    try {
      const pending = await apiClient.post<{ pendingId: string }>("/api/mcp-auth/consents/prepare", {
        householdId: preview.householdId, oauthQuery: query, noteIds: selected,
        adultAttested: adult, privacyAttested: privacy, providerSettingsReviewed: settingsReviewed, policyVersion: preview.policyVersion,
      });
      const result = await apiClient.post<{ redirectUri: string }>("/api/mcp-auth/consents/decide", { pendingId: pending.pendingId, oauthQuery: query, accept: true });
      window.location.assign(result.redirectUri);
    } catch (e) { setError(connectionError(e)); setBusy(false); }
  }
  async function deny() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await apiClient.post<{ redirectUri: string }>("/api/mcp-auth/consents/reject", { oauthQuery: query });
      window.location.assign(result.redirectUri);
    } catch (e) { setError(connectionError(e)); setBusy(false); }
  }
  return <div className="mx-auto max-w-2xl space-y-4">
    {loading && <div role="status" aria-label="Loading connection"><ContentSkeleton /></div>}
    {error && <p role="alert" className="rounded-xl border border-[var(--color-danger)] p-4 text-sm">{error} <Link className="underline" href="/settings/ai-connections">Manage AI connections</Link></p>}
    {preview && <Card><CardBody className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">Connect {preview.clientName}?</h2>
        <p className="text-sm">You are approving as <strong>{preview.memberName}</strong> in <strong>{preview.householdName}</strong>.</p>
        <p className="break-all text-xs text-[var(--color-text-muted)]">Approved client: {preview.clientId} · Profile {preview.clientProfileVersion}</p>
        <p className="text-sm text-[var(--color-text-muted)]">Provider: {preview.provider}</p>
        {preview.dataMode === "synthetic" && <p className="text-sm font-medium">Synthetic test deployment: use fictional data only.</p>}
      </header>
      <section className="space-y-2" aria-label="Requested access">
        <h3 className="font-medium">Requested access</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">{preview.scopes.map((scope) => <li key={scope}>{capabilityLabels[scope] ?? scope}</li>)}</ul>
        <p className="text-sm text-[var(--color-text-muted)]">This connection cannot change household data. It does not grant access to Google Calendar, Drive, health records or another member’s private content.</p>
      </section>
      <ProviderDataDisclosure provider={preview.provider} />
      <form onSubmit={approve} className="space-y-5">
        {preview.scopes.includes("notes:read") && <NoteConsentPicker householdId={preview.householdId} selected={selected} onChange={setSelected} disabled={busy || attempted} />}
        <fieldset disabled={busy || attempted} className="space-y-4">
          <legend className="sr-only">Required consent</legend>
          <Checkbox id="ai-adult" label="I am an adult and may share this household information." checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
          {preview.settingsReviewRequired && <Checkbox id="ai-settings-reviewed" label="I have reviewed this assistant account’s privacy and model-training settings and understand the choice I am making." checked={settingsReviewed} onChange={(e) => setSettingsReviewed(e.target.checked)} required />}
          <Checkbox id="ai-privacy" label="I understand the provider’s training, review and retention risks and agree to share this permitted information. Disconnect cannot erase copies." checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required />
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" disabled={busy || attempted || !adult || !privacy || (preview.settingsReviewRequired && !settingsReviewed)}>Allow connection</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void deny()}>Deny connection</Button>
        </div>
        {busy && <p role="status" className="text-sm">Completing your choice and returning to your assistant…</p>}
        {attempted && !busy && error && <p role="status" className="text-sm">For your security, an interrupted approval cannot be repeated. Restart from your assistant.</p>}
      </form>
    </CardBody></Card>}
    <Link href="/settings/ai-connections" className="inline-block py-3 text-sm underline">Back to AI connections</Link>
  </div>;
}
