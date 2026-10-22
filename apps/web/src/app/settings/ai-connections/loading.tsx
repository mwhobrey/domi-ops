import { ContentSkeleton } from "../../../components/ContentSkeleton";

export default function Loading() {
  return <div className="mx-auto max-w-3xl p-5" role="status" aria-label="Loading AI connections"><ContentSkeleton /></div>;
}
