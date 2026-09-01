"use client";

import { useEffect, useState } from "react";

export function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onControllerChange = () => {
      setUpdateReady(true);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting) setUpdateReady(true);

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });

        void navigator.serviceWorker.ready.then((readyReg) => {
          if (readyReg.waiting) setUpdateReady(true);
        });
      })
      .catch((err) => {
        // Was silently swallowed — a real registration failure here means push notifications
        // are completely dead for this device with zero trace anywhere (they hard-depend on
        // this service worker; confirmed live investigating a "notifications aren't working"
        // report). The PWA install banner still works from the manifest alone in many browsers
        // without this, which is presumably why this was written as "optional" — but push
        // specifically has no fallback.
        console.error("[domi-ops] service worker registration failed:", err);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-2.5 text-sm shadow-lg"
    >
      <span>Update available</span>
      <button
        type="button"
        className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-medium text-white hover:opacity-90"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
