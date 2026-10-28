"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Button, Card, CardBody, Checkbox } from "../ui";

type Props = { connectionId: string; intentId: string };
type Review = {
  intentId: string; state: string; expiresAt: string; receiptId: string | null;
  clientName?: string; householdName?: string; memberName?: string | null;
  digest?: string; nonce?: string;
  preview?: {
    title: string;
    targets: { kind: "shopping" | "chore"; id: string }[];
    changes: { field: string; before: string | null; after: string | null }[];
  };
};
const finalMessage: Record<string, string> = {
  committed: "This change was saved.", rejected: "You declined this change. Nothing was saved.",
  stale: "The records or permissions changed. Ask your assistant for a new proposal.",
  expired: "This proposal expired. Ask your assistant for a new proposal.",
};

export function AiChangeReview(props: Props) {
  return <ChangeReview key={props.connectionId + ":" + props.intentId} {...props} />;
}

function ChangeReview({ connectionId, intentId }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = "/api/mcp-writes/browser/" + encodeURIComponent(connectionId);
  useEffect(() => {
    let active = true;
    void apiClient.post<Review>(endpoint + "/review", { intentId }).then(value => {
      if (active) setReview(value);
    }).catch(() => {
      if (active) setError("This change is unavailable. Sign in to the account that owns this connection, or return to your assistant.");
    });
    return () => { active = false; };
  }, [endpoint, intentId]);

  async function checkStatus() {
    setError(null); setBusy(true); setApproved(false);
    try {
      const current = await apiClient.post<Review>(endpoint + "/review", { intentId });
      setReview(current);
      if (current.state === "pending") setAttempted(false);
    } catch { setError("This change is unavailable. Check that you are signed in to the account that owns the assistant connection."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!review?.nonce || !review.digest || !approved || attempted) return;
    setBusy(true); setAttempted(true); setError(null);
    try { setReview(await apiClient.post<Review>(endpoint + "/confirm", { intentId, digest: review.digest, nonce: review.nonce })); }
    catch { setError("The result is not confirmed. Check this same change's status before making another proposal. Do not assume the change failed."); }
    finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true); setAttempted(true); setError(null);
    try { setReview(await apiClient.post<Review>(endpoint + "/reject", { intentId })); }
    catch { setError("Could not confirm your choice. Check this change's status."); }
    finally { setBusy(false); }
  }
  const pending = review?.state === "pending" && !!review.preview;
  return <div className="mx-auto max-w-3xl space-y-5">
    <p className="text-sm">Your assistant has proposed a change. Review the saved details here before deciding.</p>
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    {!review && !error && <p role="status">Loading your proposal…</p>}
    {review && <Card><CardBody className="space-y-5">
      {pending ? <>
        <header className="space-y-2">
          <h2 className="text-xl font-semibold">{review.preview!.title}</h2>
          <p className="text-sm">Requested by {review.clientName} for <strong>{review.householdName}</strong>.</p>
          <p className="text-sm">Approving as {review.memberName ?? "your signed-in account"}. Expires {new Date(review.expiresAt).toLocaleString()}.</p>
        </header>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr><th scope="col" className="p-2">Field</th><th scope="col" className="p-2">Before</th><th scope="col" className="p-2">After</th></tr></thead>
          <tbody>{review.preview!.changes.map((change, index) => <tr key={index} className="border-t">
            <td className="p-2">{change.field}</td><td className="whitespace-pre-wrap break-words p-2">{change.before ?? "Not set"}</td><td className="whitespace-pre-wrap break-words p-2">{change.after ?? "Not set"}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="flex flex-wrap gap-3 text-sm">{review.preview!.targets.map(target =>
          <Link key={target.kind + target.id} className="underline" href={target.kind === "chore" ? "/chores?highlight=" + encodeURIComponent(target.id) : "/shopping"}>
            {target.kind === "chore" ? "View chore" : "View shopping list"}
          </Link>)}</div>
        <Checkbox id="approve-ai-change" label="I reviewed this exact change and want Domi Ops to save it." checked={approved} disabled={busy || attempted} onChange={e => setApproved(e.target.checked)} />
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={!approved || busy || attempted} onClick={() => void confirm()}>Confirm and save</Button>
          <Button type="button" variant="secondary" disabled={busy || attempted} onClick={() => void reject()}>Decline change</Button>
        </div>
      </> : <p role="status">{finalMessage[review.state] ?? "This change is unavailable."}</p>}
      {attempted && error && <Button type="button" variant="secondary" disabled={busy} onClick={() => void checkStatus()}>Check this change’s status</Button>}
      {review.receiptId && <p className="break-all text-xs">Receipt: {review.receiptId}</p>}
    </CardBody></Card>}
    <Link href="/settings/ai-connections" className="inline-block py-3 text-sm underline">Manage AI connections</Link>
  </div>;
}
