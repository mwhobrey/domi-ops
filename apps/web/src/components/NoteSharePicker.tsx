"use client";

import { useEffect } from "react";
import { Checkbox } from "./ui";

export interface NoteShareMember {
  memberId: string;
  label: string;
}

export function NoteSharePicker({
  members,
  currentMemberId,
  excludeMemberIds,
  value,
  onChange,
  disabled,
  namePrefix,
  hint,
  legend,
}: {
  members: NoteShareMember[];
  currentMemberId?: string;
  /** Additional members who already have implicit access and so shouldn't be offered as an
   *  explicit share target — e.g. a health record's subject, which can differ from (and change
   *  independently of) `currentMemberId` when the caller lets you log on someone else's behalf. */
  excludeMemberIds?: string[];
  value: string[];
  onChange: (memberIds: string[]) => void;
  disabled?: boolean;
  namePrefix: string;
  hint?: string;
  legend?: string;
}) {
  // Keying on a joined string (not the array/Set) keeps this stable across renders where the
  // caller passes a fresh `excludeMemberIds` array literal (e.g. `excludeMemberIds={[memberId]}`).
  const excludeKey = [currentMemberId, ...(excludeMemberIds ?? [])].filter(Boolean).sort().join(",");
  const excluded = new Set(excludeKey ? excludeKey.split(",") : []);
  const shareable = members.filter((m) => !excluded.has(m.memberId));

  // If who's excluded changes — most commonly the caller lets you switch which member a record
  // is about — drop any already-checked share target that's now implicitly covered instead of
  // silently submitting a stale "share with the subject" selection.
  useEffect(() => {
    const pruned = value.filter((id) => !excluded.has(id));
    if (pruned.length !== value.length) onChange(pruned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeKey]);

  if (shareable.length === 0) return null;

  const hintText =
    hint ?? "Optional. Selected members can read this private note. You always have access.";
  const legendText = legend ?? "Share with household members";

  function toggle(memberId: string, checked: boolean) {
    if (checked) {
      onChange([...new Set([...value, memberId])]);
    } else {
      onChange(value.filter((id) => id !== memberId));
    }
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-[var(--color-text)]">{legendText}</legend>
      <p className="text-xs text-[var(--color-text-muted)]">{hintText}</p>
      <ul className="space-y-2" aria-label="Share with household members">
        {shareable.map((m) => {
          const id = `${namePrefix}-share-${m.memberId}`;
          return (
            <li key={m.memberId}>
              <Checkbox
                id={id}
                name={`${namePrefix}-share`}
                label={m.label}
                checked={value.includes(m.memberId)}
                disabled={disabled}
                onChange={(e) => toggle(m.memberId, e.target.checked)}
              />
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
