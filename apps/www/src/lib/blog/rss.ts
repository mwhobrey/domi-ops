import { chicagoMidnightUtcMs } from "./date";
import type { BlogPost } from "./posts";

export const BLOG_FEED_TITLE = "Domi Ops Blog";
export const BLOG_FEED_DESCRIPTION =
  "Notes from Domi Ops on household coordination, medications, and the work of keeping a home on track.";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RFC 822 / RSS pubDate from a YYYY-MM-DD publish date (America/Chicago midnight). */
export function toRssPubDate(dateIso: string): string {
  return new Date(chicagoMidnightUtcMs(dateIso)).toUTCString();
}

/**
 * RSS 2.0 document for already-gated posts (pass the result of `listPublishedPosts`).
 * Authors use `dc:creator` because RSS `<author>` requires an email address.
 */
export function buildRssFeed(opts: { siteUrl: string; posts: BlogPost[]; now?: Date }): string {
  const siteUrl = opts.siteUrl.replace(/\/$/, "");
  const feedUrl = `${siteUrl}/blog/rss.xml`;
  const blogUrl = `${siteUrl}/blog`;
  const latest = opts.posts[0];
  const lastBuildDate = latest ? toRssPubDate(latest.date) : (opts.now ?? new Date()).toUTCString();

  const items = opts.posts
    .map((post) => {
      const link = post.canonicalUrl ?? `${siteUrl}/blog/${post.slug}`;
      const lines = [
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <description>${escapeXml(post.description)}</description>`,
        `      <pubDate>${toRssPubDate(post.date)}</pubDate>`,
        ...(post.author ? [`      <dc:creator>${escapeXml(post.author)}</dc:creator>`] : []),
        ...(post.tags ?? []).map((tag) => `      <category>${escapeXml(tag)}</category>`),
      ];
      return `    <item>\n${lines.join("\n")}\n    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(BLOG_FEED_TITLE)}</title>
    <link>${escapeXml(blogUrl)}</link>
    <description>${escapeXml(BLOG_FEED_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${items ? `${items}\n` : ""}  </channel>
</rss>
`;
}
