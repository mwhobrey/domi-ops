import { Alert, Card, CardBody, EmptyState } from "../ui";

export function ListPage({
  error,
  onDismissError,
  toolbar,
  addForm,
  children,
}: {
  error?: string | null;
  onDismissError?: () => void;
  toolbar?: React.ReactNode;
  addForm: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error">
          {error}{" "}
          {onDismissError && (
            <button type="button" className="underline" onClick={onDismissError}>
              Dismiss
            </button>
          )}
        </Alert>
      )}
      {toolbar}
      <Card>
        <CardBody>{addForm}</CardBody>
      </Card>
      {children}
    </div>
  );
}

export function ListPageEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return <EmptyState title={title} description={description} />;
}
