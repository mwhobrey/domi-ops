"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import {
  CALENDAR_ACCESS_OPTIONS,
  calendarAccessMode,
  type CalendarAccessMode,
} from "../../lib/calendar-visibility";
import { Button, Checkbox, ColorField, Input, Select } from "../ui";

type Lane = {
  id: string;
  name: string;
  color: string | null;
  visibility: "household" | "private";
  isHouseholdDefault: boolean;
  archived?: boolean;
  shareCount: number;
};

type Member = { userId: string; displayName: string | null; email: string };

type ShareRow = { userId: string; canWrite: boolean };

export function CalendarLanesPanel({ active }: { active: boolean }) {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [shareLaneId, setShareLaneId] = useState<string | null>(null);
  const [shareDraft, setShareDraft] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [consolidating, setConsolidating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calRes, memRes] = await Promise.all([
        apiClient.get<{ calendars: (Lane & { shareCount?: number })[] }>("/api/calendar/calendars"),
        apiClient.get<{ members: Member[] }>("/api/calendar/members"),
      ]);
      setLanes(
        calRes.calendars
          .filter((c) => !c.archived)
          .map((c) => ({
            ...c,
            shareCount: c.shareCount ?? 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setMembers(memRes.members);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  async function saveLane(
    id: string,
    patch: {
      name?: string;
      color?: string | null;
      visibility?: "household" | "private";
      archived?: boolean;
      isHouseholdDefault?: boolean;
    },
  ) {
    setSavingId(id);
    try {
      const res = await apiClient.patch<{ calendar: Lane }>(`/api/calendar/calendars/${id}`, patch);
      if (patch.archived) {
        setLanes((prev) => prev.filter((l) => l.id !== id));
      } else {
        setLanes((prev) =>
          res.calendar.isHouseholdDefault
            ? prev.map((l) =>
                l.id === id
                  ? { ...l, ...res.calendar, shareCount: l.shareCount }
                  : { ...l, isHouseholdDefault: false },
              )
            : prev.map((l) =>
                l.id === id ? { ...l, ...res.calendar, shareCount: l.shareCount } : l,
              ),
        );
      }
    } catch {
      /* ignore */
    } finally {
      setSavingId(null);
    }
  }

  async function clearShares(laneId: string) {
    await apiClient.patch(`/api/calendar/calendars/${laneId}/shares`, { shares: [] });
    setLanes((prev) =>
      prev.map((l) => (l.id === laneId ? { ...l, shareCount: 0 } : l)),
    );
  }

  async function setAccessMode(laneId: string, mode: CalendarAccessMode) {
    setSavingId(laneId);
    try {
      if (mode === "public") {
        const res = await apiClient.patch<{ calendar: Lane }>(
          `/api/calendar/calendars/${laneId}`,
          { visibility: "household" },
        );
        await clearShares(laneId);
        setLanes((prev) =>
          prev.map((l) =>
            l.id === laneId ? { ...l, ...res.calendar, shareCount: 0 } : l,
          ),
        );
        setShareLaneId(null);
      } else if (mode === "private") {
        const res = await apiClient.patch<{ calendar: Lane }>(
          `/api/calendar/calendars/${laneId}`,
          { visibility: "private" },
        );
        await clearShares(laneId);
        setLanes((prev) =>
          prev.map((l) =>
            l.id === laneId ? { ...l, ...res.calendar, shareCount: 0 } : l,
          ),
        );
        setShareLaneId(null);
      } else {
        const res = await apiClient.patch<{ calendar: Lane }>(
          `/api/calendar/calendars/${laneId}`,
          { visibility: "private" },
        );
        setLanes((prev) =>
          prev.map((l) => (l.id === laneId ? { ...l, ...res.calendar } : l)),
        );
        await openShares(laneId);
      }
    } catch {
      /* ignore */
    } finally {
      setSavingId(null);
    }
  }

  async function createLane() {
    const name = newName.trim();
    if (!name) return;
    setSavingId("new");
    try {
      const res = await apiClient.post<{ calendar: Lane }>("/api/calendar/calendars", {
        name,
        visibility: "household",
      });
      setLanes((prev) =>
        [...prev, { ...res.calendar, shareCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewName("");
    } catch {
      /* ignore */
    } finally {
      setSavingId(null);
    }
  }

  async function openShares(laneId: string) {
    setShareLaneId(laneId);
    try {
      const res = await apiClient.get<{ shares: { userId: string; canWrite: boolean }[] }>(
        `/api/calendar/calendars/${laneId}/shares`,
      );
      setShareDraft(res.shares.map((s) => ({ userId: s.userId, canWrite: s.canWrite })));
    } catch {
      setShareDraft([]);
    }
  }

  async function saveShares() {
    if (!shareLaneId) return;
    setSavingId(shareLaneId);
    try {
      await apiClient.patch(`/api/calendar/calendars/${shareLaneId}/shares`, {
        shares: shareDraft,
      });
      const count = shareDraft.length;
      setLanes((prev) =>
        prev.map((l) => (l.id === shareLaneId ? { ...l, shareCount: count } : l)),
      );
      setShareLaneId(null);
    } catch {
      /* ignore */
    } finally {
      setSavingId(null);
    }
  }

  const homeHubDupes = lanes.filter((l) => l.name === "Imported from HomeHub").length;

  async function consolidateHomeHubBuckets() {
    setConsolidating(true);
    try {
      const res = await apiClient.post<{ merged: number }>(
        "/api/calendar/calendars/consolidate-duplicates",
        { name: "Imported from HomeHub" },
      );
      if (res.merged > 0) await load();
    } catch {
      /* ignore */
    } finally {
      setConsolidating(false);
    }
  }

  if (!active) return null;
  if (loading && lanes.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading calendars…</p>;
  }

  return (
    <div className="space-y-4">
      {homeHubDupes > 1 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/50 p-3 text-sm">
          <p className="text-[var(--color-text-muted)]">
            {homeHubDupes} duplicate &quot;Imported from HomeHub&quot; calendars from repeated imports.
            Merge into one?
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2"
            loading={consolidating}
            onClick={() => void consolidateHomeHubBuckets()}
          >
            Merge duplicate HomeHub calendars
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          placeholder="New calendar name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={savingId === "new"}
        />
        <Button size="sm" type="button" loading={savingId === "new"} onClick={() => void createLane()}>
          Add calendar
        </Button>
      </div>

      {lanes.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          No calendars yet. Add one above or import from Google.
        </p>
      ) : (
        <ul className="space-y-3">
          {lanes.map((lane) => {
            const access = calendarAccessMode(lane.visibility, lane.shareCount);
            const accessHint =
              CALENDAR_ACCESS_OPTIONS.find((o) => o.value === access)?.hint ?? "";
            return (
              <li
                key={lane.id}
                className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="w-full min-w-[12rem] max-w-xs shrink-0">
                    <ColorField
                      compact
                      ariaLabel={`Color for ${lane.name}`}
                      value={lane.color ?? "#3b82f6"}
                      disabled={savingId === lane.id}
                      onChange={(hex) => void saveLane(lane.id, { color: hex })}
                    />
                  </div>
                  <Input
                    className="min-w-0 flex-1"
                    value={lane.name}
                    disabled={savingId === lane.id}
                    onChange={(e) =>
                      setLanes((prev) =>
                        prev.map((l) => (l.id === lane.id ? { ...l, name: e.target.value } : l)),
                      )
                    }
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      const prior = lanes.find((l) => l.id === lane.id)?.name;
                      if (name && name !== prior) void saveLane(lane.id, { name });
                    }}
                  />
                </div>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Who can see this calendar</span>
                  <Select
                    value={access}
                    disabled={savingId === lane.id}
                    aria-label={`Access for ${lane.name}`}
                    onChange={(e) =>
                      void setAccessMode(lane.id, e.target.value as CalendarAccessMode)
                    }
                  >
                    {CALENDAR_ACCESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <span className="block text-xs text-[var(--color-text-muted)]">{accessHint}</span>
                </label>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Checkbox
                    label="Default calendar"
                    checked={lane.isHouseholdDefault}
                    disabled={savingId === lane.id}
                    onChange={() => void saveLane(lane.id, { isHouseholdDefault: true })}
                  />
                  {access === "shared" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void openShares(lane.id)}
                    >
                      Manage sharing…
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-[var(--color-danger)]"
                    disabled={savingId === lane.id}
                    onClick={() => void saveLane(lane.id, { archived: true })}
                  >
                    Archive
                  </Button>
                </div>
                {shareLaneId === lane.id && (
                  <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3">
                    <p className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">
                      Shared with (pick members)
                    </p>
                    <ul className="mb-2 space-y-1">
                      {members
                        .filter((m) => m.userId)
                        .map((m) => {
                          const row = shareDraft.find((s) => s.userId === m.userId);
                          const label = m.displayName ?? m.email ?? m.userId;
                          return (
                            <li key={m.userId} className="flex items-center gap-2">
                              <Checkbox
                                label={label}
                                checked={Boolean(row)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setShareDraft((prev) => [
                                      ...prev.filter((s) => s.userId !== m.userId),
                                      { userId: m.userId, canWrite: false },
                                    ]);
                                  } else {
                                    setShareDraft((prev) =>
                                      prev.filter((s) => s.userId !== m.userId),
                                    );
                                  }
                                }}
                              />
                              {row && (
                                <Checkbox
                                  label="Can edit"
                                  checked={row.canWrite}
                                  onChange={(e) =>
                                    setShareDraft((prev) =>
                                      prev.map((s) =>
                                        s.userId === m.userId
                                          ? { ...s, canWrite: e.target.checked }
                                          : s,
                                      ),
                                    )
                                  }
                                />
                              )}
                            </li>
                          );
                        })}
                    </ul>
                    <div className="flex gap-2">
                      <Button size="sm" type="button" onClick={() => void saveShares()}>
                        Save sharing
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setShareLaneId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
