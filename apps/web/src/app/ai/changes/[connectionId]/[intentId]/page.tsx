import { AppShell } from "../../../../../components/AppShell";
import { AiChangeReview } from "../../../../../components/ai/AiChangeReview";

export default async function ChangeReviewPage({params}:{params:Promise<{connectionId:string;intentId:string}>}){
  const {connectionId,intentId}=await params;
  return <AppShell title="Review proposed change"><AiChangeReview connectionId={connectionId} intentId={intentId}/></AppShell>;
}
