import { AppShell } from "../../components/AppShell";
import { ContentSkeleton } from "../../components/ContentSkeleton";

export default function Loading() {
  return <AppShell title="Goals"><ContentSkeleton variant="report" /></AppShell>;
}
