import { Card, CardBody } from "../ui/Card";

export function ChatGptConnectionSetup({ enabled, serverUrl, setupUrl }: { enabled: boolean; serverUrl: string; setupUrl: string }) {
  return <Card><CardBody className="space-y-3">
    <h2 className="font-semibold">Connect ChatGPT</h2>
    <p className="text-sm">Connect your ChatGPT account to the household information you approve. You will sign in to Domi Ops and review permissions before any information is shared.</p>
    {enabled ? <>
      <a href={setupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl bg-[var(--color-accent)] px-4 py-2 font-medium text-white">Open ChatGPT plugins</a>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Choose Add, then Add custom MCP server.</li>
        <li>Enter Domi Ops and the server URL below. Choose OAuth and published identity (CIMD), if asked.</li>
        <li>Leave client credentials and request headers empty. Review ChatGPT’s warning, then connect and approve the intended Domi Ops permissions.</li>
      </ol>
      <p className="text-sm text-[var(--color-text-muted)]">Availability depends on your ChatGPT account and workspace. A directory listing is still pending.</p>
    </> : <p className="text-sm">Enable AI connections for this household first, then continue here.</p>}
    <p className="break-all text-sm text-[var(--color-text-muted)]">Your server: {serverUrl}</p>
  </CardBody></Card>;
}
