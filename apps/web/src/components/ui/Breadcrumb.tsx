import Link from "next/link";
import { cn } from "../../lib/cn";

export type BreadcrumbItem = { label: string; href?: string };

export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-4 text-sm", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-[var(--color-text-muted)]">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-[var(--color-text)]">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? "text-[var(--color-text)]" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
