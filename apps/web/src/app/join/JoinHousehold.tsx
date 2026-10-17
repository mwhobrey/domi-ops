"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, ApiError } from "../../lib/client-api";
import { authClient } from "../../lib/auth-client";
import { Alert, Button, Input } from "../../components/ui";

type Invitation = { householdName: string; email: string; role: string; signedIn: boolean; expiresAt: string };
function message(error: unknown) {
  if (error instanceof ApiError) {
    try {
      const data = JSON.parse(error.body ?? "{}") as { error?: string; message?: string };
      const messages: Record<string, string> = {
        invitation_invalid_or_expired: "This invitation has expired, was revoked, or has already been used. Ask your household owner for a new invitation.",
        verify_email_required: "Verify your email first. Use the verification link in your inbox, then return here.",
        invitation_email_mismatch: "This invitation is for a different email address. Sign out and use the invited account.",
        already_in_another_household: "Your account already belongs to another household. Contact support before moving your account.",
      };
      return data.message ?? messages[data.error ?? ""] ?? "Could not join this household. Please try again.";
    } catch { /* fall through */ }
  }
  return error instanceof Error ? error.message : "Could not join this household.";
}

export function JoinHousehold({ token, googleEnabled, oauthError }: { token?: string; googleEnabled: boolean; oauthError: boolean }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(oauthError ? "Google sign-in did not complete. Try email and password, or try Google again." : null);
  const [info, setInfo] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const data = await apiClient.post<Invitation>("/api/invitations/prepare", token ? { token } : {});
    setInvitation(data);
    // The server keeps the invitation in an HttpOnly cookie through sign-in.
    // Remove its secret from address-bar history and subsequent navigation referrers.
    window.history.replaceState(null, "", "/join");
  }, [token]);
  useEffect(() => { void load().catch((err) => setError(message(err))); }, [load]);

  async function authenticate(event: React.FormEvent) {
    event.preventDefault(); if (!invitation) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const result = mode === "signup"
        ? await authClient.signUp.email({ email: invitation.email, password, name: name.trim() || invitation.email.split("@")[0], callbackURL: "/join" })
        : await authClient.signIn.email({ email: invitation.email, password, callbackURL: "/join" });
      if (result.error) { setError(result.error.message ?? "Sign-in failed."); return; }
      if (mode === "signup") setInfo("Account created. Verify your email using the link in your inbox, then return here to join.");
      setPassword(""); await load();
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function accept() {
    setBusy(true); setError(null);
    try { await apiClient.post("/api/invitations/accept", {}); window.location.assign("/dashboard"); }
    catch (err) { setError(message(err)); setBusy(false); }
  }
  async function resend() {
    if (!invitation) return;
    setBusy(true); setError(null);
    try {
      const result = await authClient.sendVerificationEmail({ email: invitation.email, callbackURL: "/join" });
      if (result.error) setError(result.error.message ?? "Could not send verification email.");
      else setInfo("Check your email for the verification link, then return here.");
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-5 py-10">
    <Link href="/" className="font-display text-2xl font-semibold">Domi Ops</Link>
    <h1 className="text-xl font-semibold">{invitation ? `Join ${invitation.householdName}` : "Join your household"}</h1>
    {error && <Alert variant="error">{error}</Alert>}
    {info && <p role="status" className="text-sm">{info}</p>}
    {!invitation && !error && <p role="status">Loading invitation…</p>}
    {invitation && <>
      <p className="text-sm text-[var(--color-text-muted)]">You are invited as a {invitation.role} using {invitation.email}. Your household subscription covers you; no second checkout is needed.</p>
      {invitation.signedIn ? <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void accept()}>Join household</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void resend()}>Resend verification email</Button>
        <Button variant="secondary" disabled={busy} onClick={async () => { await authClient.signOut(); await load(); }}>Use another account</Button>
      </div> : <>
        <form onSubmit={authenticate} className="space-y-4">
          <label className="block space-y-1"><span>Email</span><Input type="email" value={invitation.email} readOnly autoComplete="email" /></label>
          {mode === "signup" && <label className="block space-y-1"><span>Your name</span><Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>}
          <label className="block space-y-1"><span>Password</span><Input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{mode === "signup" ? "Create your account" : "Sign in"}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Use an existing account" : "I need an account"}</Button></div>
        </form>
        {googleEnabled && <Button variant="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { const result = await authClient.signIn.social({ provider: "google", callbackURL: "/join", errorCallbackURL: "/join?error=google" }); if (result.error) setError(result.error.message ?? "Google sign-in failed."); }
          catch (err) { setError(message(err)); }
          finally { setBusy(false); }
        }}>Continue with Google</Button>}
      </>}
    </>}
    <p className="text-sm"><a href="mailto:support@domi-ops.com" className="underline">Need help?</a> · <Link href="/privacy" className="underline">Privacy</Link></p>
  </main>;
}
