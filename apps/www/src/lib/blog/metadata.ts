import type { Metadata } from "next";
import { pageSocial } from "../og";
import type { BlogPost } from "./posts";

export const BLOG_FEED_PATH = "/blog/rss.xml";

/** `alternates.types` entry that advertises the RSS feed in the document head. */
export const BLOG_FEED_ALTERNATE_TYPES = {
  "application/rss+xml": [{ url: BLOG_FEED_PATH, title: "Domi Ops Blog" }],
};

/** Same-origin path of a post's generated 1200x630 share card. */
export function postShareImagePath(slug: string): string {
  return `/blog/${slug}/og.png`;
}

/** Page metadata for a published post, including its own share card for Open Graph and Twitter. */
export function postMetadata(post: BlogPost): Metadata {
  const title = `${post.title} | Domi Ops`;
  const path = `/blog/${post.slug}`;
  return {
    title,
    description: post.description,
    alternates: { canonical: post.canonicalUrl ?? path, types: BLOG_FEED_ALTERNATE_TYPES },
    ...pageSocial({
      title,
      description: post.description,
      path,
      type: "article",
      publishedTime: post.date,
      image: { path: postShareImagePath(post.slug), alt: post.title },
    }),
  };
}
