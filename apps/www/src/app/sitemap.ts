import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/faq";

const PATHS = ["", "/homeschool", "/health", "/pricing", "/faq", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/homeschool" || path === "/health" ? 0.8 : 0.5,
  }));
}
