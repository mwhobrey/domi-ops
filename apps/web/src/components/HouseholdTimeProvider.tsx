"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { todayIsoInTimeZone } from "../lib/household-date";

// Context, not a module variable: on the server a module is shared across requests, so a
// module-level zone would leak one household's timezone into another's render.
const HouseholdTimeZoneContext = createContext<string | null>(null);

export function HouseholdTimeProvider({
  timeZone,
  children,
}: {
  timeZone: string | null;
  children: React.ReactNode;
}) {
  return (
    <HouseholdTimeZoneContext.Provider value={timeZone}>{children}</HouseholdTimeZoneContext.Provider>
  );
}

export function useHouseholdTimeZone(): string | null {
  return useContext(HouseholdTimeZoneContext);
}

/**
 * Today's date (YYYY-MM-DD) in the household timezone. Re-checks every minute so a page left
 * open across midnight rolls over. Server and client agree because the zone is explicit.
 */
export function useHouseholdToday(): string {
  const timeZone = useHouseholdTimeZone();
  const [today, setToday] = useState(() => todayIsoInTimeZone(timeZone));
  useEffect(() => {
    setToday(todayIsoInTimeZone(timeZone));
    const id = window.setInterval(() => setToday(todayIsoInTimeZone(timeZone)), 60_000);
    return () => window.clearInterval(id);
  }, [timeZone]);
  return today;
}
