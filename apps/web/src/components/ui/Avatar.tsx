import { cn } from "../../lib/cn";
import { avatarStyle } from "../../lib/member-color";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function Avatar({
  id,
  name,
  src,
  size = "md",
  className,
}: {
  id: string;
  name: string;
  /** Same-origin `/api/core/avatars/:memberId` when set */
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const style = avatarStyle(id);
  const sizeClass = {
    sm: "h-7 w-7 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
  }[size];

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn("inline-block shrink-0 rounded-full object-cover", sizeClass, className)}
        width={size === "lg" ? 48 : size === "md" ? 40 : 28}
        height={size === "lg" ? 48 : size === "md" ? 40 : 28}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizeClass,
        className,
      )}
      style={style}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
