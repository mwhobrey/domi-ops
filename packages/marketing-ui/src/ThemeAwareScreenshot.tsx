import { marketingScreenshotPath, type MarketingScreenshot } from "./marketing-screenshots";

type ThemeAwareScreenshotProps = MarketingScreenshot & {
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  preload?: boolean;
};

export function ThemeAwareScreenshot({
  alt,
  className,
  loading = "lazy",
  preload = false,
  priority,
  id,
  suffix,
  width,
  height,
}: ThemeAwareScreenshotProps) {
  const shot: MarketingScreenshot = { priority, id, suffix, width, height };
  const light = marketingScreenshotPath(shot, "light");
  const dark = marketingScreenshotPath(shot, "dark");

  return (
    <picture className={className}>
      <source srcSet={light} media="(prefers-color-scheme: light)" />
      <img
        src={dark}
        alt={alt}
        width={width}
        height={height}
        loading={preload ? "eager" : loading}
        decoding="async"
        className="h-auto w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-elevated)]"
      />
    </picture>
  );
}
