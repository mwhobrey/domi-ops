import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { isUserBusy, shouldRefreshOnReturn } from "./refresh-on-return";

/**
 * Pages are server-rendered and most client lists copy their props into useState once, so a tab
 * left open shows old data until a manual reload. When the tab comes back after a while: re-fetch
 * the server data, then return a new key. Put it on the page content so client state re-seeds
 * from the fresh props. Skipped whenever the user has something open or half-typed.
 */
export function useRefreshOnReturn(): number {
  const router = useRouter();
  const [key, setKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const leftAt = useRef<number | null>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    const onLeave = () => {
      leftAt.current ??= Date.now();
    };
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const awayMs = leftAt.current === null ? null : Date.now() - leftAt.current;
      leftAt.current = null;
      if (!shouldRefreshOnReturn({ awayMs, busy: isUserBusy(document) })) return;
      startTransition(() => router.refresh());
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? onLeave() : onReturn());

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onLeave);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("focus", onReturn);
    };
  }, [router]);

  useEffect(() => {
    // Refresh finished. Remount unless the user started something while it was loading.
    if (wasPending.current && !pending && !isUserBusy(document)) setKey((k) => k + 1);
    wasPending.current = pending;
  }, [pending]);

  return key;
}
