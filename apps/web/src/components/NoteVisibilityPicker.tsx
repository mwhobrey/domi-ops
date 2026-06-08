"use client";

import type { NoteVisibility } from "../lib/note-visibility";
import { NOTE_VISIBILITY_OPTIONS } from "../lib/note-visibility";
import { RadioGroup } from "./ui";

export function NoteVisibilityPicker({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: NoteVisibility;
  onChange: (value: NoteVisibility) => void;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      legend="Who can see this note?"
      name={name}
      value={value}
      onChange={(next) => onChange(next as NoteVisibility)}
      options={NOTE_VISIBILITY_OPTIONS.map((opt) => ({
        value: opt.value,
        disabled,
        label: (
          <span>
            <span className="font-medium">{opt.label}</span>
            <span className="block text-xs text-[var(--color-text-muted)]">{opt.description}</span>
          </span>
        ),
      }))}
    />
  );
}
