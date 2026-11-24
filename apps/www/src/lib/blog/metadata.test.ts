import { describe, expect, it } from "vitest";
import { BLOG_FEED_ALTERNATE_TYPES, postMetadata, postShareImagePath } from "./metadata";
import type { BlogPost } from "./posts";

const post: BlogPost = {
  title: "Why I Built Domi Ops",
  slug: "why-i-built-domi-ops",
  date: "2026-11-23",
  description: "Launch notes.",
  body: "unused",
};

describe("postMetadata", () => {
  it("points Open Graph and Twitter at the post's own share card with the title as alt", () => {
    const metadata = postMetadata(post);
    const og = metadata.openGraph as { images: { url: string; width: number; height: number; alt: string }[] };
    const twitter = metadata.twitter as { card: string; images: { url: string; alt: string }[] };

    expect(og.images).toEqual([
      { url: "/blog/why-i-built-domi-ops/og.png", width: 1200, height: 630, alt: "Why I Built Domi Ops" },
    ]);
    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.images).toEqual([{ url: "/blog/why-i-built-domi-ops/og.png", alt: "Why I Built Domi Ops" }]);
    expect(JSON.stringify(metadata)).not.toContain("og-default.png");
  });

  it("advertises the RSS feed and keeps the canonical URL", () => {
    expect(postMetadata(post).alternates).toEqual({
      canonical: "/blog/why-i-built-domi-ops",
      types: BLOG_FEED_ALTERNATE_TYPES,
    });
    expect(postMetadata({ ...post, canonicalUrl: "https://example.com/x" }).alternates?.canonical).toBe(
      "https://example.com/x",
    );
    expect(BLOG_FEED_ALTERNATE_TYPES["application/rss+xml"][0].url).toBe("/blog/rss.xml");
  });

  it("builds the share image path from the slug", () => {
    expect(postShareImagePath("abc")).toBe("/blog/abc/og.png");
  });
});
