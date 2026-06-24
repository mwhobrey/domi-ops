"use client";

export function DemoModeBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return null;

  return (
    <div
      className="mb-4 rounded-[var(--radius-lg)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)] px-4 py-3 text-sm text-[var(--color-text)]"
      role="status"
    >
      <strong className="font-medium">Demo household</strong>
      <span className="text-[var(--color-text-muted)]">
        {" "}
        — shared playground; resets daily at 4:00 AM Central Time.
      </span>
    </div>
  );
}
