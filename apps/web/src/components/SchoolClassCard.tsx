import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { hueFromId } from "../lib/member-color";
import { enrollmentRoleLabel, enrollmentRoleTone } from "../lib/school-enrollment";
import { cn } from "../lib/cn";
import { Badge, Card, CardBody } from "./ui";

export function SchoolClassCard({
  id,
  name,
  subject,
  term,
  enrollmentRole,
}: {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
  enrollmentRole?: string | null;
}) {
  const accentHue = hueFromId(id);

  return (
    <Link
      href={`/school/class/${id}`}
      className={cn(
        "group block h-full rounded-[var(--radius-xl)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
      )}
      aria-label={[name, subject, term].filter(Boolean).join(", ")}
    >
      <Card className="h-full overflow-hidden transition group-hover:border-[var(--color-accent)]/50 group-hover:shadow-md">
        <div
          className="h-1 w-full"
          style={{ background: `hsl(${accentHue} 55% 45%)` }}
          aria-hidden
        />
        <CardBody className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-[var(--color-text)] group-hover:text-[var(--color-accent)]">
              {name}
            </h2>
            {subject ? (
              <p className="mt-1 truncate text-sm text-[var(--color-text-muted)]">{subject}</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]/60">No subject</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {term && <Badge tone="accent">{term}</Badge>}
              {enrollmentRole && (
                <Badge tone={enrollmentRoleTone(enrollmentRole)}>
                  {enrollmentRoleLabel(enrollmentRole)}
                </Badge>
              )}
            </div>
          </div>
          <ChevronRight
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-text-muted)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        </CardBody>
      </Card>
    </Link>
  );
}
