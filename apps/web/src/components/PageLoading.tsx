import { Card, CardBody, Skeleton } from "./ui";

export function PageLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </CardBody>
      </Card>
    </div>
  );
}
