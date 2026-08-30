"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { runPendingTourIfAny } from "../lib/tours";

/** Drop this on any page a checklist tour can land on (Settings, Calendar, Profile) — picks up
 *  a tour queued by OnboardingChecklist's launchTour() and runs it once this page has mounted.
 *  Renders nothing. */
export function PendingTourRunner() {
  const pathname = usePathname();
  useEffect(() => {
    runPendingTourIfAny(pathname);
  }, [pathname]);
  return null;
}
