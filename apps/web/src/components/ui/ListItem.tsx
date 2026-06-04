import { cn } from "../../lib/cn";

export function ListItem({
  className,
  children,
  onClick,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  as?: "div" | "li" | "button";
}) {
  const base = cn(
    "flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 px-4 py-3 transition hover:bg-[var(--color-surface-subtle)]",
    Tag === "button" && "w-full text-left",
    className,
  );
  if (Tag === "button") {
    return (
      <button type="button" className={base} onClick={onClick}>
        {children}
      </button>
    );
  }
  if (Tag === "li") {
    return <li className={base}>{children}</li>;
  }
  return <div className={base}>{children}</div>;
}
