"use client";
import { useState } from "react";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui";

/** Credentials are intentionally public and supplied only on the server's demo deployment. */
export function DemoRolePicker({ email, password }: { email: string; password: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function enter(role: "parent" | "student" | "caregiver") {
    setPending(true); setError(null);
    try {
      await authClient.signOut();
      const result = role === "parent" ? await authClient.signIn.email({ email, password })
        : await authClient.signIn.username({ username: role === "student" ? "sofia" : "james", password });
      if (result.error) { setError("Could not open this demo view. Try the demo login below or contact support."); return; }
      window.location.assign(role === "caregiver" ? "/health" : "/school");
    } catch { setError("The demo sign-in service is unavailable. Please try again."); }
    finally { setPending(false); }
  }
  return <section aria-label="Choose a demo role" className="space-y-3">
    <p className="text-sm">Explore fictional records as a parent, student or caregiver. No account or card needed.</p>
    <div className="flex flex-wrap gap-2"><Button disabled={pending} onClick={() => void enter("parent")}>Parent</Button><Button variant="secondary" disabled={pending} onClick={() => void enter("student")}>Student</Button><Button variant="secondary" disabled={pending} onClick={() => void enter("caregiver")}>Caregiver</Button></div>
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
  </section>;
}
