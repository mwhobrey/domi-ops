import { ImageResponse } from "next/og";
import { OG_IMAGE_SIZE } from "../og";
import { formatPostDate } from "./date";
import { getPublishedPost } from "./posts";

// Colors from packages/marketing-ui/src/marketing-tokens.css (dark theme).
const SURFACE = "#0c0f14";
const ACCENT = "#3b82f6";
const ACCENT_MUTED = "#1d4ed8";
const TEXT = "#f1f5f9";
const TEXT_MUTED = "#94a3b8";

/**
 * 1200x630 share card for a published post, or a 404 that is never stored by a shared cache.
 * Uses the same America/Chicago gate as the post page, so a future post exposes no image.
 */
export function renderPostShareImage(slug: string, now: Date = new Date(), dir?: string): Response {
  const post = getPublishedPost(slug, now, dir);
  if (!post) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-cache, no-store" },
    });
  }

  const description =
    post.description.length > 160 ? `${post.description.slice(0, 157).trimEnd()}…` : post.description;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: SURFACE,
          backgroundImage: `radial-gradient(ellipse 80% 50% at 50% -20%, ${ACCENT} 0%, transparent 50%), radial-gradient(ellipse 50% 40% at 100% 100%, ${ACCENT_MUTED} 0%, transparent 45%)`,
          color: TEXT,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            Domi Ops · Blog
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              maxWidth: 980,
            }}
          >
            {post.title}
          </div>
          <div style={{ display: "flex", fontSize: 28, lineHeight: 1.4, color: TEXT_MUTED, maxWidth: 920 }}>
            {description}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: TEXT_MUTED,
          }}
        >
          <span>{formatPostDate(post.date)}</span>
          <span style={{ color: TEXT, fontWeight: 600 }}>domi-ops.com</span>
        </div>
      </div>
    ),
    {
      ...OG_IMAGE_SIZE,
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    },
  );
}
