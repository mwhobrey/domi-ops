import { AppShell } from "../../components/AppShell";
import { PageLoading } from "../../components/PageLoading";

// `breadcrumb` here matches page.tsx passing one too, even though the loading state can't know
// the real content yet — this is purely cosmetic (avoids a layout jump between the skeleton and
// real content) rather than fixing a rendering bug. A 2026-08-30 investigation into a suspected
// Suspense-reveal bug (thought to be triggered by loading.tsx/page.tsx shape mismatches) turned
// out to be a false positive caused by unreliable browser-automation tooling in that session —
// see the domi-ops-monolith-audit memory for the full writeup. No such bug exists; keep the
// shapes matched anyway for the layout-stability benefit.
export default function DriveLoading() {
  return (
    <AppShell title="Drive" breadcrumb={[{ label: "Drive" }]}>
      <PageLoading />
    </AppShell>
  );
}
