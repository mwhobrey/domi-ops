"use client";

import { useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ApiError, apiClient } from "../lib/client-api";
import { openGooglePicker, type GooglePickerFile } from "../lib/google-picker";
import { Alert, Button } from "./ui";

interface PickerSession {
  connected: boolean;
  connectUrl: string;
  accessToken?: string;
  developerKey?: string;
  appId?: string;
}

export function GooglePickerButton({
  onPicked,
  disabled,
  children = "Add from Google",
  title,
}: {
  onPicked: (file: GooglePickerFile) => void | Promise<void>;
  disabled?: boolean;
  children?: React.ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formsHint, setFormsHint] = useState(false);

  const returnPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  const openPicker = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFormsHint(false);
    try {
      const session = await apiClient.get<PickerSession>(
        `/api/core/google/docs/picker-session?next=${encodeURIComponent(returnPath)}`,
      );

      if (!session.connected || !session.accessToken) {
        window.location.href = session.connectUrl;
        return;
      }
      if (!session.developerKey || !session.appId) {
        setError("Google Picker is not configured on the server.");
        return;
      }

      await openGooglePicker({
        accessToken: session.accessToken,
        developerKey: session.developerKey,
        appId: session.appId,
        title,
        onPicked: (file) => {
          void onPicked(file);
        },
        onFormsRejected: () => {
          setFormsHint(true);
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          try {
            const data = JSON.parse(err.body ?? "{}") as { connectUrl?: string };
            if (data.connectUrl) {
              window.location.href = data.connectUrl;
              return;
            }
          } catch {
            /* ignore parse */
          }
          setError("Reconnect Google Docs in profile settings, then try again.");
          return;
        }
        if (err.status === 503) {
          setError(
            "Google Picker is not configured. Check GOOGLE_PICKER_API_KEY and that the OAuth client id yields a numeric GCP project number (see docs/GOOGLE_OAUTH_SETUP.md §9).",
          );
          return;
        }
        setError(err.message);
        return;
      }
      setError("Could not open Google Picker.");
    } finally {
      setLoading(false);
    }
  }, [onPicked, returnPath, title]);

  return (
    <div className="inline-flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={loading}
        disabled={disabled || loading}
        onClick={() => void openPicker()}
      >
        {children}
      </Button>
      {formsHint ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Google Forms cannot be attached here. Use Add link instead.
        </p>
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
    </div>
  );
}
