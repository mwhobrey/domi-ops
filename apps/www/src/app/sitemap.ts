import type { MetadataRoute } from "next";
import { listPublishedPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/faq";

const PATHS = ["", "/about", "/homeschool", "/health", "/pricing", "/faq", "/privacy", "/terms", "/blog"];

// Re-evaluate published posts on each request so a date-gated entry appears at
// America/Chicago midnight without waiting for a rebuild.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries = PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" || path === "/blog" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/homeschool" || path === "/health" || path === "/blog" ? 0.8 : 0.5,
  })) satisfies MetadataRoute.Sitemap;

  const postEntries = listPublishedPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.date,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticEntries, ...postEntries];
}
