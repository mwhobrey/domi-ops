"use client";

import { useEffect } from "react";

/**
 * Replaces the root layout when the layout itself throws, so it can't rely on globals.css
 * tokens or fonts being present — keep the styling inline and self-contained.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[domi-ops web] fatal error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          background: "#0b0e14",
          color: "#e6e9ef",
        }}
      >
        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0 0 1rem" }}>Domi Ops</p>
          <h1 style={{ fontSize: "1rem", fontWeight: 500, margin: "0 0 0.5rem", color: "#9aa4b2" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#9aa4b2", margin: "0 0 1.25rem" }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#9aa4b2" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "2.75rem",
              padding: "0 1rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
