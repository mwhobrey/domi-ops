import { AppShell } from "../../components/AppShell";
import { PageLoading } from "../../components/PageLoading";

export default function Loading() {
  return (
    <AppShell title="Notes">
      <PageLoading />
    </AppShell>
  );
}
