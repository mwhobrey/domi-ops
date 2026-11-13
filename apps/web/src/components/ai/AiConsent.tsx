"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { capabilityLabels, connectionError, defaultCapabilities, type ConsentPreview, type MedGroupChoice } from "../../lib/mcp";
import { MedGroupChoices } from "./MedGroupChoices";
import { CalendarChoices } from "./CalendarChoices";
import { Button, Card, CardBody, Checkbox } from "../ui";
import { ContentSkeleton } from "../ContentSkeleton";
import { NoteConsentPicker } from "./NoteConsentPicker";
import { CapabilityChoices } from "./CapabilityChoices";
import { ProviderDataDisclosure } from "./ProviderDataDisclosure";

export function AiConsent() {
  const [preview, setPreview] = useState<ConsentPreview | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [medGroups, setMedGroups] = useState<MedGroupChoice[]>([]);
  const [healthAck, setHealthAck] = useState(false);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);
  const sharingGroups = capabilities.includes("health.groups.read") && medGroups.length > 0;
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
        if (!cancelled) { setQuery(oauthQuery); setPreview(value); setCapabilities(defaultCapabilities(value.availableCapabilities)); }
      } catch (e) { if (!cancelled) setError(connectionError(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!preview || busy || attempted || !adult || !privacy || (preview.settingsReviewRequired && !settingsReviewed) || (sharingGroups && !healthAck)) return;
    setBusy(true); setAttempted(true); setError(null);
    try {
      const pending = await apiClient.post<{ pendingId: string }>("/api/mcp-auth/consents/prepare", {
        householdId: preview.householdId, oauthQuery: query, noteIds: capabilities.includes("notes.read") ? selected : [], capabilities,
        ...(capabilities.includes("calendar.availability") && calendarIds.length ? { calendarIds } : {}),
        ...(sharingGroups ? { healthAcknowledged: healthAck, medGroups: medGroups.map((choice) => ({ ...choice, canLog: choice.canLog && capabilities.includes("health.groups.log") })) } : {}),
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
      <section className="space-y-3" aria-label="Access you are choosing">
        <h3 className="font-medium">Choose what {preview.clientName} can do</h3>
        <CapabilityChoices idPrefix="consent" householdId={preview.householdId} options={preview.availableCapabilities} selected={capabilities} onChange={setCapabilities} disabled={busy || attempted} />
        {preview.scopes.includes("offline_access") && <p className="text-sm">{capabilityLabels.offline_access}.</p>}
        <p className="text-sm text-[var(--color-text-muted)]">{capabilities.some((name) => preview.availableCapabilities.find((option) => option.name === name)?.access === "write") ? "Only the actions you switched on above can change household data." : "With these choices this connection cannot change household data."} It does not grant access to event details, Google Calendar, Drive, medication names, other health records or another member’s private content. You can change these choices later in AI connections.</p>
      </section>
      <ProviderDataDisclosure provider={preview.provider} />
      <form onSubmit={approve} className="space-y-5">
        {capabilities.includes("health.groups.read") && <MedGroupChoices idPrefix="consent" householdId={preview.householdId} allowLog={capabilities.includes("health.groups.log")}
          value={medGroups} onChange={setMedGroups} disabled={busy || attempted} />}
        {capabilities.includes("calendar.availability") && <CalendarChoices idPrefix="consent" householdId={preview.householdId} value={calendarIds} onChange={setCalendarIds} disabled={busy || attempted} />}
        {capabilities.includes("notes.read") && <NoteConsentPicker householdId={preview.householdId} selected={selected} onChange={setSelected} disabled={busy || attempted} />}
        <fieldset disabled={busy || attempted} className="space-y-4">
          <legend className="sr-only">Required consent</legend>
          <Checkbox id="ai-adult" label="I am an adult and may share this household information." checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
          {preview.settingsReviewRequired && <Checkbox id="ai-settings-reviewed" label="I have reviewed this assistant account’s privacy and model-training settings and understand the choice I am making." checked={settingsReviewed} onChange={(e) => setSettingsReviewed(e.target.checked)} required />}
          {sharingGroups && <Checkbox id="ai-health" label={`I understand that when I take my medication and whether I logged it are personal health information, and that ${preview.clientName}’s provider will receive and keep them under its own terms.`} checked={healthAck} onChange={(e) => setHealthAck(e.target.checked)} required />}
          <Checkbox id="ai-privacy" label="I understand the provider’s training, review and retention risks and agree to share this permitted information. Disconnect cannot erase copies." checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required />
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" disabled={busy || attempted || !adult || !privacy || (preview.settingsReviewRequired && !settingsReviewed) || (sharingGroups && !healthAck)}>Allow connection</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void deny()}>Deny connection</Button>
        </div>
        {busy && <p role="status" className="text-sm">Completing your choice and returning to your assistant…</p>}
        {attempted && !busy && error && <p role="status" className="text-sm">For your security, an interrupted approval cannot be repeated. Restart from your assistant.</p>}
      </form>
    </CardBody></Card>}
    <Link href="/settings/ai-connections" className="inline-block py-3 text-sm underline">Back to AI connections</Link>
  </div>;
}
