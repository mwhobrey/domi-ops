import { Card, CardBody } from "../ui/Card";

export function GrokBotConnectionSetup({ enabled, serverUrl }: { enabled: boolean; serverUrl: string }) {
  return <Card><CardBody className="space-y-3">
    <h2 className="font-semibold">Connect Grok Bot</h2>
    <p className="text-sm">Read shared household shopping and chores through Grok Bot’s cloud connection. Each member approves their own access in Domi Ops.</p>
    {enabled ? <>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>In Grok Bot, ask to add a custom remote MCP connection using the server URL below.</li>
        <li>Specify the public client ID <code className="break-all">https://cursor.com/oauth/mcp-client.json</code> and scopes <code className="break-all">shopping:read chores:read offline_access</code>. Do not use automatic client registration.</li>
        <li>Choose Authenticate or Authorize, then sign in to this Domi Ops server.</li>
        <li>Review the household, shopping, chores and background access before approving. Stop if it asks for notes or write access.</li>
      </ol>
      <p className="text-sm">This uses the published Cursor cloud identity shared with Grok Bot. Leave client secrets, API keys and request headers empty. App connections can be available to your other Bots.</p>
      <p className="text-sm text-[var(--color-text-muted)]">A fictional-data briefing has been tested in Grok Bot desktop. Directory listing is pending; ordinary Grok chat and Cursor desktop have not been verified.</p>
    </> : <p className="text-sm">Enable AI connections for this household first, then continue here.</p>}
    <p className="break-all text-sm text-[var(--color-text-muted)]">Your server: {serverUrl}</p>
  </CardBody></Card>;
}
