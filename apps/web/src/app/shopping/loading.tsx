import { AppShell } from "../../components/AppShell";
import { PageLoading } from "../../components/PageLoading";

export default function Loading() {
  return (
    <AppShell title="Shopping list" description="Shared household shopping">
      <PageLoading />
    </AppShell>
  );
}
