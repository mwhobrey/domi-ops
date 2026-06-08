"use client";

import { Checkbox } from "./ui";

export interface NoteShareMember {
  memberId: string;
  label: string;
}

export function NoteSharePicker({
  members,
  currentMemberId,
  value,
  onChange,
  disabled,
  namePrefix,
}: {
  members: NoteShareMember[];
  currentMemberId?: string;
  value: string[];
  onChange: (memberIds: string[]) => void;
  disabled?: boolean;
  namePrefix: string;
}) {
  const shareable = members.filter((m) => m.memberId !== currentMemberId);
  if (shareable.length === 0) return null;

  function toggle(memberId: string, checked: boolean) {
    if (checked) {
      onChange([...new Set([...value, memberId])]);
    } else {
      onChange(value.filter((id) => id !== memberId));
    }
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-[var(--color-text)]">
        Share with household members
      </legend>
      <p className="text-xs text-[var(--color-text-muted)]">
        Optional. Selected members can read this private note.
      </p>
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
