"use client";

import { Share2, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { HealthEvent, HealthMedication } from "./HealthPageClient";
import { HealthPeopleAccessPanel } from "./HealthPeopleAccessPanel";
import type { NoteShareMember } from "./NoteSharePicker";
import { NoteSharePicker } from "./NoteSharePicker";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  LinkButton,
  ListItem,
  SectionHeader,
  Sheet,
} from "./ui";

type Tab = "people" | "with-me" | "by-me";

function memberLabel(members: NoteShareMember[], memberId: string): string {
  return members.find((m) => m.memberId === memberId)?.label ?? "Member";
}

export function HealthSharingClient({
  members,
  currentMemberId,
  householdRole,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  householdRole: string;
}) {
  const [tab, setTab] = useState<Tab>("people");
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [medications, setMedications] = useState<HealthMedication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareEdit, setShareEdit] = useState<
    | { kind: "event"; record: HealthEvent }
    | { kind: "medication"; record: HealthMedication }
    | null
  >(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, medsRes] = await Promise.all([
        apiClient.get<{ events: HealthEvent[] }>("/api/health/events"),
        apiClient.get<{ medications: HealthMedication[] }>("/api/health/medications"),
      ]);
      setEvents(eventsRes.events ?? []);
      setMedications(medsRes.medications ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load shared records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const sharedWithMeEvents = useMemo(
    () => events.filter((e) => e.sharedWithMe === true),
    [events],
  );
  const sharedWithMeMeds = useMemo(
    () => medications.filter((m) => m.sharedWithMe === true),
    [medications],
  );
  const sharedByMeEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          e.isOwnedByMe === true &&
          e.visibility === "private" &&
          (e.sharedMemberIds?.length ?? 0) > 0,
      ),
    [events],
  );
  const sharedByMeMeds = useMemo(
    () =>
      medications.filter(
        (m) =>
          m.isOwnedByMe === true &&
          m.visibility === "private" &&
          (m.sharedMemberIds?.length ?? 0) > 0,
      ),
    [medications],
  );

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "people" as const, label: "People access" },
            { key: "with-me" as const, label: "Shared with me" },
            { key: "by-me" as const, label: "I've shared" },
          ] as const
        ).map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? "primary" : "secondary"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "people" ? (
        <HealthPeopleAccessPanel
          members={members}
          currentMemberId={currentMemberId}
          householdRole={householdRole}
        />
      ) : null}

      {tab === "with-me" ? (
        <div className="space-y-6">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : sharedWithMeEvents.length === 0 && sharedWithMeMeds.length === 0 ? (
            <EmptyState
              icon={<Share2 className="h-8 w-8" aria-hidden />}
              title="Nothing shared with you"
              description="When someone shares a private event or medication with you, it shows up here."
            />
          ) : (
            <>
              <section className="space-y-2">
                <SectionHeader title="Events" />
                {sharedWithMeEvents.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No shared events.</p>
                ) : (
                  sharedWithMeEvents.map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/health?event=${ev.id}`}
                      className="block rounded-[var(--radius-lg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                    >
                      <ListItem>
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <div className="min-w-0 text-left">
                            <p className="truncate font-medium text-[var(--color-text)]">{ev.title}</p>
                            <p className="truncate text-sm text-[var(--color-text-muted)]">
                              {memberLabel(members, ev.memberId)} · {ev.type}
                            </p>
                          </div>
                          <Badge tone="default">Shared</Badge>
                        </div>
                      </ListItem>
                    </Link>
                  ))
                )}
              </section>
              <section className="space-y-2">
                <SectionHeader title="Medications" />
                {sharedWithMeMeds.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No shared medications.</p>
                ) : (
                  sharedWithMeMeds.map((med) => (
                    <Link
                      key={med.id}
                      href={`/health?medication=${med.id}`}
                      className="block rounded-[var(--radius-lg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                    >
                      <ListItem>
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <div className="min-w-0 text-left">
                            <p className="truncate font-medium text-[var(--color-text)]">{med.name}</p>
                            <p className="truncate text-sm text-[var(--color-text-muted)]">
                              {memberLabel(members, med.memberId)} ·{" "}
                              {med.scheduleKind === "prn" ? "PRN" : "Scheduled"}
                            </p>
                          </div>
                          <Badge tone="default">Shared</Badge>
                        </div>
                      </ListItem>
                    </Link>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      ) : null}

      {tab === "by-me" ? (
        <div className="space-y-6">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : sharedByMeEvents.length === 0 && sharedByMeMeds.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" aria-hidden />}
              title="No private records shared"
              description="Private records you share with specific people will show up here."
            />
          ) : (
            <>
              <section className="space-y-2">
                <SectionHeader title="Events" />
                {sharedByMeEvents.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No shared events.</p>
                ) : (
                  sharedByMeEvents.map((ev) => (
                    <SharedByMeRow
                      key={ev.id}
                      title={ev.title}
                      subtitle={ev.type}
                      shareeIds={ev.sharedMemberIds ?? []}
                      members={members}
                      onEdit={() => setShareEdit({ kind: "event", record: ev })}
                      openHref={`/health?event=${ev.id}`}
                    />
                  ))
                )}
              </section>
              <section className="space-y-2">
                <SectionHeader title="Medications" />
                {sharedByMeMeds.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No shared medications.</p>
                ) : (
                  sharedByMeMeds.map((med) => (
                    <SharedByMeRow
                      key={med.id}
                      title={med.name}
                      subtitle={med.scheduleKind === "prn" ? "PRN" : "Scheduled"}
                      shareeIds={med.sharedMemberIds ?? []}
                      members={members}
                      onEdit={() => setShareEdit({ kind: "medication", record: med })}
                      openHref={`/health?medication=${med.id}`}
                    />
                  ))
                )}
              </section>
            </>
          )}
        </div>
      ) : null}

      <RecordShareEditSheet
        edit={shareEdit}
        members={members}
        currentMemberId={currentMemberId}
        onClose={() => setShareEdit(null)}
        onSaved={() => {
          setShareEdit(null);
          void loadLists();
        }}
      />
    </div>
  );
}

function SharedByMeRow({
  title,
  subtitle,
  shareeIds,
  members,
  onEdit,
  openHref,
}: {
  title: string;
  subtitle: string;
  shareeIds: string[];
  members: NoteShareMember[];
  onEdit: () => void;
  openHref: string;
}) {
  return (
    <ListItem>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--color-text)]">{title}</p>
          <p className="truncate text-sm text-[var(--color-text-muted)]">{subtitle}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {shareeIds.map((id) => (
              <Badge key={id} tone="default">
                {memberLabel(members, id)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>
            Edit sharing
          </Button>
          <LinkButton href={openHref} size="sm" variant="ghost">
            Open
          </LinkButton>
        </div>
      </div>
    </ListItem>
  );
}

function RecordShareEditSheet({
  edit,
  members,
  currentMemberId,
  onClose,
  onSaved,
}: {
  edit:
    | { kind: "event"; record: HealthEvent }
    | { kind: "medication"; record: HealthMedication }
    | null;
  members: NoteShareMember[];
  currentMemberId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = Boolean(edit);
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!edit) return;
    setSharedMemberIds(edit.record.sharedMemberIds ?? []);
    setErr(null);
  }, [edit]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      if (edit.kind === "event") {
        await apiClient.patch(`/api/health/events/${edit.record.id}`, {
          visibility: "private",
          sharedMemberIds,
        });
      } else {
        await apiClient.patch(`/api/health/medications/${edit.record.id}`, {
          visibility: "private",
          sharedMemberIds,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update sharing");
    } finally {
      setBusy(false);
    }
  }

  const title =
    edit?.kind === "event"
      ? `Share: ${edit.record.title}`
      : edit?.kind === "medication"
        ? `Share: ${edit.record.name}`
        : "Edit sharing";

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <NoteSharePicker
          members={members}
          currentMemberId={currentMemberId}
          value={sharedMemberIds}
          onChange={setSharedMemberIds}
          namePrefix="health-record-share"
          hint="Selected members can read this private record. Segment access (People access) is separate."
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
