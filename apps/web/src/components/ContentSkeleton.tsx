import { Skeleton } from "./ui/Skeleton";

export function ContentSkeleton({
  variant = "list",
  label = "Loading content",
}: {
  variant?: "list" | "chart" | "report";
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="w-full space-y-4">
      <span className="sr-only">{label}</span>
      {variant === "report" ? (
        <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : null}
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        {variant === "list" ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </>
        ) : <Skeleton className="h-56 w-full" />}
      </div>
    </div>
  );
}
