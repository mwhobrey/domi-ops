import { AppShell } from "../../../components/AppShell";
import { AiConnections } from "../../../components/ai/AiConnections";

export default function AiConnectionsPage() {
  return <AppShell title="AI connections" description="Review what your assistants can read and disconnect them at any time."><AiConnections /></AppShell>;
}
