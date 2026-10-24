import { Card, CardBody } from "../ui/Card";

export function ClaudeConnectionSetup({ enabled, connectUrl, serverUrl }: { enabled: boolean; connectUrl: string; serverUrl: string }) {
  return <Card><CardBody className="space-y-3">
    <h2 className="font-semibold">Connect Claude</h2>
    <p className="text-sm">Use your Claude account to read the household information you approve. You will sign in to Domi Ops and review permissions before any information is shared.</p>
    {enabled ? <>
      <a href={connectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl bg-[var(--color-accent)] px-4 py-2 font-medium text-white">Continue in Claude</a>
      <p className="text-sm text-[var(--color-text-muted)]">Keep sign-in required and choose Claude’s published identity if asked. Leave client credentials and request headers empty.</p>
    </> : <p className="text-sm">Enable AI connections for this household first, then continue here.</p>}
    <p className="break-all text-sm text-[var(--color-text-muted)]">Your server: {serverUrl}</p>
  </CardBody></Card>;
}
