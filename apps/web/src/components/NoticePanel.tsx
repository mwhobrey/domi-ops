"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Card, CardBody, CardHeader, Textarea } from "./ui";

export function NoticePanel({ initialNotice }: { initialNotice: string }) {
  const [notice, setNotice] = useState(initialNotice);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "error" | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <Card className="h-full">
      <CardHeader>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Notice board
        </h2>
      </CardHeader>
      <CardBody>
        <Textarea
          className="min-h-[140px]"
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
          placeholder="Leave a note for the household…"
        />
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{notice.length} characters</p>
        <Button
          className="mt-3"
          loading={loading}
          onClick={async () => {
            setLoading(true);
            setMsg(null);
            setVariant(null);
            try {
              await apiClient.patch("/api/core/dashboard/notice", { content: notice });
              setMsg("Saved");
              setVariant("success");
            } catch (err) {
              setMsg(err instanceof ApiError ? err.message : "Failed");
              setVariant("error");
            } finally {
              setLoading(false);
            }
          }}
        >
          Save notice
        </Button>
        {msg && variant && (
          <Alert variant={variant} className="mt-3">
            {msg}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
