import { AppShell } from "../../../components/AppShell";
import { ContentSkeleton } from "../../../components/ContentSkeleton";

export default function Loading() {
  return <AppShell title="Records" breadcrumb={[{ label: "School", href: "/school" }, { label: "Records" }]}><ContentSkeleton variant="report" /></AppShell>;
}
