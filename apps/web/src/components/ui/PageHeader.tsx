import { PageHeaderActions } from "./PageHeaderActions";

export type PageHeaderDescriptionVisibility = "always" | "desktop" | "never";

export function PageHeader({
  title,
  description,
  descriptionVisibility = "desktop",
  actions,
  size = "default",
}: {
  title: string;
  description?: string;
  descriptionVisibility?: PageHeaderDescriptionVisibility;
  actions?: React.ReactNode;
  size?: "default" | "lg";
}) {
  const showDescription =
    description &&
    descriptionVisibility !== "never" &&
    (descriptionVisibility === "always" || descriptionVisibility === "desktop");

  const descriptionClassName =
    descriptionVisibility === "always"
      ? "mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]"
      : "mt-1 hidden max-w-2xl text-sm text-[var(--color-text-muted)] lg:block";

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 max-lg:items-center no-print">
      <div>
        <h1
          className={
            size === "lg"
              ? "font-display text-4xl font-semibold tracking-tight sm:text-5xl"
              : "text-2xl font-semibold tracking-tight"
          }
        >
          {title}
        </h1>
        {showDescription && (
          <p className={descriptionClassName}>{description}</p>
        )}
      </div>
      {actions && <PageHeaderActions>{actions}</PageHeaderActions>}
    </div>
  );
}
