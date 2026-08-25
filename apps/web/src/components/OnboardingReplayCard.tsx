"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Card, CardBody, SectionHeader } from "./ui";

/**
 * Resets this member's onboarding checklist (dismissed + step progress) so it
 * shows again on the dashboard — for re-testing the walkthrough, or for a member
 * who dismissed it early and wants it back.
 */
export function OnboardingReplayCard() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function replay() {
    setPending(true);
    setErr(null);
    try {
      await apiClient.patch("/api/core/onboarding", { dismissed: false, stepsDone: [] });
      router.push("/dashboard");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't reset the checklist");
      setPending(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <SectionHeader title="Getting-started checklist" />
        <p className="text-sm text-[var(--color-text-muted)]">
          Bring back the first-login checklist on your dashboard — useful if you dismissed it
          early, or want to walk through it again.
        </p>
        {err ? <Alert variant="error">{err}</Alert> : null}
        <Button variant="secondary" loading={pending} onClick={() => void replay()}>
          Replay checklist
        </Button>
      </CardBody>
    </Card>
  );
}
