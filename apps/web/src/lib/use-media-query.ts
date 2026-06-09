"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    function onChange(e: MediaQueryListEvent) {
      setMatches(e.matches);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tablet landscape / small laptop — week+day grid vs month+agenda on calendar */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 900px)");
}
