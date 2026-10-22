import { ContentSkeleton } from "../../../components/ContentSkeleton";

export default function Loading() {
  return <div className="mx-auto max-w-2xl p-5" role="status" aria-label="Loading connection"><ContentSkeleton /></div>;
}
