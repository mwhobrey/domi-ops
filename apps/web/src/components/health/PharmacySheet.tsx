"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Button, Input, Sheet, Textarea } from "../ui";
import { pharmacyErrorMessage } from "./pharmacy-helpers";
import type { Pharmacy } from "./supply-types";

/** Add or edit one pharmacy in the household directory (WHO-421). */
export function PharmacySheet({
  open,
  pharmacy,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The pharmacy being edited, or null to add a new one. */
  pharmacy: Pharmacy | null;
  onClose: () => void;
  onSaved: (saved: Pharmacy) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(pharmacy?.name ?? "");
    setAddress(pharmacy?.address ?? "");
    setPhone(pharmacy?.phone ?? "");
    setWebsite(pharmacy?.website ?? "");
    setNotes(pharmacy?.notes ?? "");
    setErr(null);
  }, [open, pharmacy]);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      // A blank optional field is sent as null: when editing, that clears it; when adding, it is ignored.
      const body = {
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
        notes: notes.trim() || null,
      };
      const res = pharmacy
        ? await apiClient.patch<{ pharmacy: Pharmacy }>(`/api/health/pharmacies/${pharmacy.id}`, body)
        : await apiClient.post<{ pharmacy: Pharmacy }>("/api/health/pharmacies", body);
      onSaved(res.pharmacy);
    } catch (e) {
      setErr(pharmacyErrorMessage(e, "Could not save the pharmacy. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={pharmacy ? "Edit pharmacy" : "Add pharmacy"}>
      <form
        className="space-y-4 px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Address</span>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={500} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Phone</span>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" maxLength={40} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Website</span>
          {/* type="text", not "url": the browser would refuse the bare "walgreens.com" the API accepts. */}
          <Input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="walgreens.com"
            maxLength={2048}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Notes</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
