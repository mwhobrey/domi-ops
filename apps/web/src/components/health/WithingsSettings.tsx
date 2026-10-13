"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import type { HealthAclGrants } from "../HealthPeopleAccessPanel";
import type { NoteShareMember } from "../NoteSharePicker";
import { WithingsPanel } from "./WithingsPanel";

const noop = () => {};

/**
 * The Withings cuff panel for Settings and Profile (WHO-453), next to the MyAllyFile card. It is the
 * same panel that sits on Health, Checks; this only loads who the viewer can manage, the way
 * `MyAllyFileSettings` does, because those pages don't have it. Renders nothing when the health
 * module is off or the roster can't load.
 */
export function WithingsSettings() {
  const [people, setPeople] = useState<{
    members: NoteShareMember[];
    capabilities: Record<string, HealthAclGrants>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiClient.get<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiClient.get<{ bySubject: Record<string, HealthAclGrants> }>("/api/health/capabilities"),
    ])
      .then(([roster, caps]) => {
        if (!cancelled) setPeople({ members: roster.members, capabilities: caps.bySubject ?? {} });
      })
      .catch(() => {
        // Optional card: health module off, or the lists can't load. Just hide it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!people) return null;
  return <WithingsPanel members={people.members} capabilities={people.capabilities} notice={null} onDismissNotice={noop} />;
}
