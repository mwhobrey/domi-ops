"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/client-api";
import { Alert, AnchorButton } from "./ui";

export function SchoolGoogleDocsConnectBanner({
  assignmentId,
  show,
}: {
  assignmentId: string;
  show?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const [connected, setConnected] = useState(true);
  const [connectUrl, setConnectUrl] = useState(
    `/auth/google/docs/start?next=${encodeURIComponent(`/school/assignment/${assignmentId}`)}`,
  );

  useEffect(() => {
    if (show === false) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void apiClient
      .get<{ needsGoogle: boolean; connected: boolean; connectUrl: string }>(
        `/api/school/assignments/${assignmentId}/google-readiness`,
      )
      .then((data) => {
        if (cancelled) return;
        setNeedsGoogle(data.needsGoogle);
        setConnected(data.connected);
        setConnectUrl(data.connectUrl);
      })
      .catch(() => {
        if (!cancelled) setNeedsGoogle(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, show]);

  if (loading || !needsGoogle || connected) return null;

  return (
    <Alert variant="info">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Connect Google Docs to start and submit tests on this assignment.
        </p>
        <AnchorButton href={connectUrl} size="sm" variant="secondary">
          Connect Google Docs
        </AnchorButton>
      </div>
    </Alert>
  );
}
