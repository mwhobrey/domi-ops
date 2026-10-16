import { Card, CardBody } from "./ui";
import { ContentSkeleton } from "./ContentSkeleton";

export function PageLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <ContentSkeleton />
        </CardBody>
      </Card>
    </div>
  );
}
