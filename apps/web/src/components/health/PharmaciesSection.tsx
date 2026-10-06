"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { Alert, Badge, Button, Card, CardBody, Checkbox, ConfirmDialog, EmptyState, SectionHeader } from "../ui";
import { PharmacySheet } from "./PharmacySheet";
import {
  apiErrorCode,
  mapsSearchHref,
  medicationCountLabel,
  pharmacyErrorMessage,
  safeWebsiteHref,
  sortPharmacies,
  telHref,
} from "./pharmacy-helpers";
import type { Pharmacy } from "./supply-types";

const linkClass = "text-[var(--color-accent)] underline-offset-2 hover:underline";

/**
 * The household's pharmacy directory, under Health → Medications (WHO-421). Everyone with health access
 * can look; the add, edit and archive actions only show for people the API says may change it.
 */
export function PharmaciesSection({
  refreshKey = 0,
  onChanged,
}: {
  /** Changes when the medications were reloaded, which can change the counts shown here. */
  refreshKey?: number;
  /** Called after the directory changed (saved, archived, restored), so medications showing a pharmacy can reload. */
  onChanged?: () => void;
}) {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Pharmacy | null>(null);
  const [confirming, setConfirming] = useState<{ pharmacy: Pharmacy; count: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ pharmacies: Pharmacy[]; canEdit: boolean }>("/api/health/pharmacies?includeArchived=true");
      setPharmacies(res.pharmacies);
      setCanEdit(res.canEdit);
    } catch (e) {
      setError(pharmacyErrorMessage(e, "Could not load pharmacies."));
    } finally {
      setLoading(false);
    }
  }, []);

  // `refreshKey` changes when the medications were reloaded, which can change the counts shown here.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const archivedCount = pharmacies.filter((p) => p.archivedAt !== null).length;
  const visible = useMemo(
    () => sortPharmacies(pharmacies).filter((p) => showArchived || p.archivedAt === null),
    [pharmacies, showArchived],
  );

  async function archive(pharmacy: Pharmacy, confirm: boolean) {
    setBusyId(pharmacy.id);
    setError(null);
    try {
      await apiClient.post(`/api/health/pharmacies/${pharmacy.id}/archive`, confirm ? { confirm: true } : {});
      setConfirming(null);
      await load();
      onChanged?.();
    } catch (e) {
      if (!confirm && apiErrorCode(e) === "confirmation_required") {
        let count = pharmacy.medicationCount;
        try {
          const body = JSON.parse((e as ApiError).body ?? "{}") as { medicationCount?: number };
          if (typeof body.medicationCount === "number") count = body.medicationCount;
        } catch {
          // keep the count from the list
        }
        setConfirming({ pharmacy, count });
      } else {
        setConfirming(null);
        setError(pharmacyErrorMessage(e, "Could not archive the pharmacy."));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function restore(pharmacy: Pharmacy) {
    setBusyId(pharmacy.id);
    setError(null);
    try {
      await apiClient.post(`/api/health/pharmacies/${pharmacy.id}/unarchive`, {});
      await load();
      onChanged?.();
    } catch (e) {
      setError(pharmacyErrorMessage(e, "Could not restore the pharmacy."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title="Pharmacies" />
          {canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setSheetOpen(true);
              }}
            >
              + Add pharmacy
            </Button>
          ) : null}
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}

        {archivedCount > 0 ? (
          <Checkbox
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            label={`Show archived (${archivedCount})`}
          />
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={archivedCount > 0 ? "No active pharmacies" : "No pharmacies yet"}
            description={
              archivedCount > 0
                ? "Every pharmacy is archived. Show archived to restore one."
                : canEdit
                  ? "Add the pharmacies your household uses so refills and medications can point to them."
                  : "No pharmacies have been added for this household."
            }
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((p) => {
              const tel = telHref(p.phoneTel);
              const site = safeWebsiteHref(p.website);
              const maps = mapsSearchHref(p.address);
              const archived = p.archivedAt !== null;
              return (
                <li key={p.id} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-[var(--color-text)]">
                        {p.name}
                        {archived ? (
                          <span className="ml-2">
                            <Badge>Archived</Badge>
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm text-[var(--color-text-muted)]">{medicationCountLabel(p.medicationCount)}</p>
                    </div>
                    {canEdit ? (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(p);
                            setSheetOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        {archived ? (
                          <Button size="sm" variant="secondary" loading={busyId === p.id} onClick={() => void restore(p)}>
                            Restore
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" loading={busyId === p.id} onClick={() => void archive(p, false)}>
                            Archive
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {p.address || p.phone || p.website ? (
                    <ul className="space-y-1 text-sm">
                      {p.address ? (
                        <li className="break-words whitespace-pre-line text-[var(--color-text)]">
                          {maps ? (
                            <a className={linkClass} href={maps} target="_blank" rel="noopener noreferrer">
                              {p.address}
                            </a>
                          ) : (
                            p.address
                          )}
                        </li>
                      ) : null}
                      {p.phone ? (
                        <li>
                          {tel ? (
                            <a className={linkClass} href={tel}>
                              Call {p.phone}
                            </a>
                          ) : (
                            <span className="text-[var(--color-text)]">{p.phone}</span>
                          )}
                        </li>
                      ) : null}
                      {p.website ? (
                        <li className="break-all">
                          {site ? (
                            <a className={linkClass} href={site} target="_blank" rel="noopener noreferrer">
                              {site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          ) : (
                            <span className="text-[var(--color-text)]">{p.website}</span>
                          )}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}

                  {p.notes ? (
                    <p className="whitespace-pre-line break-words text-sm text-[var(--color-text-muted)]">{p.notes}</p>
                  ) : null}

                  {p.medications.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.medications.map((m) => (
                        <Badge key={m.id}>
                          {m.name}
                          {m.enabled ? "" : " · paused"}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      <PharmacySheet
        open={sheetOpen}
        pharmacy={editing}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setSheetOpen(false);
          setEditing(null);
          void load();
          onChanged?.();
        }}
      />

      <ConfirmDialog
        open={confirming !== null}
        title="Archive pharmacy?"
        message={
          confirming
            ? `${confirming.pharmacy.name} is used by ${confirming.count} current medication${confirming.count === 1 ? "" : "s"}. They keep it as their pharmacy, but it will no longer be offered when choosing one. You can restore it later.`
            : ""
        }
        confirmLabel="Archive"
        loading={confirming !== null && busyId === confirming.pharmacy.id}
        onConfirm={() => confirming && void archive(confirming.pharmacy, true)}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  );
}
