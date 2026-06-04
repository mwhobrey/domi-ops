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

/** lg breakpoint — week grid vs agenda on calendar */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
