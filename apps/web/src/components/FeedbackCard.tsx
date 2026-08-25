"use client";

import { useState } from "react";
import { Alert, Button, Card, CardBody, Input, SectionHeader, Textarea } from "./ui";

/**
 * Always available to every member, regardless of the household's telemetry opt-in —
 * sending a bug report is its own one-time, user-authored consent for that one message,
 * not passive background collection. See apps/web/src/lib/telemetry.ts.
 */
export function FeedbackCard({
  endpoint,
  deploymentMode,
}: {
  endpoint: string;
  deploymentMode: string;
}) {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  async function submit() {
    if (!message.trim()) return;
    setPending(true);
    setResult(null);
    try {
      const { submitBugReport } = await import("../lib/telemetry");
      const ok = await submitBugReport({
        message: message.trim(),
        email: email.trim() || undefined,
        endpoint,
        deploymentMode,
      });
      setResult(ok ? "success" : "error");
      if (ok) {
        setMessage("");
        setEmail("");
      }
    } catch {
      setResult("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <SectionHeader title="Send feedback" />
        <p className="text-sm text-[var(--color-text-muted)]">
          Found a bug or have an idea? This goes straight to the person building Domi Ops — not
          your household, not anyone else in your family.
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">What happened?</span>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="The Calendar week view didn't load after I..."
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email (optional, if you'd like a reply)</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <Button loading={pending} disabled={!message.trim()} onClick={() => void submit()}>
          Send
        </Button>
        {result === "success" ? <Alert variant="success">Thanks — feedback sent.</Alert> : null}
        {result === "error" ? (
          <Alert variant="error">Couldn't send that. Please try again in a moment.</Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
