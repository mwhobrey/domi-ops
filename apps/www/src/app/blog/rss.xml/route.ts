import { buildRssFeed, listPublishedPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/faq";

// Date-gating must run at request time so a post appears in the feed at
// America/Chicago midnight without waiting for a redeploy.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const xml = buildRssFeed({
    siteUrl: SITE_URL,
    posts: listPublishedPosts(),
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
