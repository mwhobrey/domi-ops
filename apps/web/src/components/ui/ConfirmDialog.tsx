"use client";

import { Button } from "./Button";
import { Card, CardBody, CardFooter, CardHeader } from "./Card";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="font-semibold">{title}</h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-[var(--color-text-muted)]">{message}</p>
        </CardBody>
        <CardFooter className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
