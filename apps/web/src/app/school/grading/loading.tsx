import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";

export default function Loading() {
  return (
    <AppShell
      title="To grade"
      breadcrumb={[{ label: "School", href: "/school" }, { label: "To grade" }]}
    >
      <PageLoading />
    </AppShell>
  );
}
