import { ContentSkeleton } from "../components/ContentSkeleton";
import { Skeleton } from "../components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-[var(--color-border)] p-4">
        <Skeleton className="mx-auto h-8 w-full max-w-6xl" />
      </div>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Skeleton className="h-8 w-48" />
        <ContentSkeleton variant="report" label="Loading page" />
      </main>
    </div>
  );
}
