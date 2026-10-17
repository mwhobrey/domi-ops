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
        — fictional records in a shared playground. Changes are visible to other visitors and may be reset. Do not enter private information or connect real accounts.
      </span>
      <nav aria-label="Explore the demo" className="mt-2 flex flex-wrap gap-3">
        <a href="/login?demo=switch" className="underline">Choose parent, student or caregiver view</a>
        <a href="/school" className="underline">School</a>
        <a href="/health" className="underline">Health</a>
        <a href="/calendar" className="underline">Calendar</a>
      </nav>
    </div>
  );
}
