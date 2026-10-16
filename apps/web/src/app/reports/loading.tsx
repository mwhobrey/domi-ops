import { AppShell } from "../../components/AppShell";
import { ContentSkeleton } from "../../components/ContentSkeleton";

export default function Loading() {
  return <AppShell title="Reports"><ContentSkeleton variant="report" /></AppShell>;
}
