import { AppShell } from "../../components/AppShell";
import { ContentSkeleton } from "../../components/ContentSkeleton";
import { Skeleton } from "../../components/ui";

export default function HealthLoading() {
  return (
    <AppShell title="Health" description="Symptoms, appointments, and medications">
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-xl" />
        <ContentSkeleton label="Loading health" />
      </div>
    </AppShell>
  );
}
