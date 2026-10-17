"use client";
import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import { Alert, Button, Card, CardBody, Input, SectionHeader, Select } from "./ui";

type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };
export function HouseholdInvitationsPanel({ isOwner }: { isOwner: boolean }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [delivery, setDelivery] = useState("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(Date.now);
  const load = useCallback(async () => { const data = await apiClient.get<{ invitations: Invitation[] }>("/api/core/household/invitations"); setInvitations(data.invitations); setAsOf(Date.now()); }, []);
  useEffect(() => { void load().catch(() => setError("Could not load invitations.")); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setInfo(null); setJoinUrl(null);
    try {
      const result = await apiClient.post<{ joinUrl?: string; delivered: boolean }>("/api/core/household/invitations", { email, role, delivery });
      setJoinUrl(result.joinUrl ?? null); setInfo(result.delivered ? "Invitation sent. It expires in 7 days." : "Share this link privately with the invited person. It expires in 7 days.");
      setEmail(""); await load();
    } catch (err) {
      if (err instanceof ApiError) { try { const data = JSON.parse(err.body ?? "{}"); setError(data.message ?? "Could not create invitation."); } catch { setError("Could not create invitation."); } }
      else setError("Could not create invitation.");
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError(null);
    try { await apiClient.delete(`/api/core/household/invitations/${id}`); setJoinUrl(null); await load(); }
    catch { setError("Could not revoke invitation."); }
    finally { setBusy(false); }
  }
  return <Card data-tour="adult-invites"><CardBody className="space-y-4">
    <SectionHeader title="Invite an adult" />
    <p className="text-sm text-[var(--color-text-muted)]">They use their own verified email or Google account and join your existing household subscription.</p>
    {error && <Alert variant="error">{error}</Alert>}{info && <p role="status" className="text-sm">{info}</p>}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={create}>
      <label className="space-y-1 sm:col-span-2"><span>Email address</span><Input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="space-y-1"><span>Role</span><Select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value)}><option value="member">Member</option>{isOwner && <option value="admin">Admin</option>}<option value="guest">Guest</option></Select></label>
      <label className="space-y-1"><span>Delivery</span><Select aria-label="Delivery" value={delivery} onChange={(event) => setDelivery(event.target.value)}><option value="email">Send email</option><option value="link">Create private link</option></Select></label>
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Create invitation</Button></div>
    </form>
    {joinUrl && <label className="block space-y-1"><span className="text-sm">Private invitation link</span><Input value={joinUrl} readOnly onFocus={(event) => event.target.select()} /><Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(joinUrl); setInfo("Invitation link copied."); } catch { setInfo("Select and copy the invitation link above."); } }}>Copy link</Button></label>}
    {invitations.length > 0 && <ul className="divide-y divide-[var(--color-border)]">{invitations.map((invitation) => {
      const status = invitation.acceptedAt ? "Accepted" : invitation.revokedAt ? "Revoked" : new Date(invitation.expiresAt).getTime() <= asOf ? "Expired" : "Pending";
      return <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{invitation.email} · {invitation.role} · {status}</span>{status === "Pending" && <Button variant="secondary" disabled={busy} onClick={() => void revoke(invitation.id)}>Revoke</Button>}</li>;
    })}</ul>}
  </CardBody></Card>;
}
