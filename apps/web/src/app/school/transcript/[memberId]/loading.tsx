import { AppShell } from "../../../../components/AppShell";
import { ContentSkeleton } from "../../../../components/ContentSkeleton";

export default function Loading() {
  return <AppShell title="Transcript" breadcrumb={[{ label: "School", href: "/school" }, { label: "Records", href: "/school/records" }, { label: "Transcript" }]}><ContentSkeleton variant="report" /></AppShell>;
}
