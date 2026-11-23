import fs from "node:fs";
import path from "node:path";
import { isPostPublished } from "./date";
import { parseBlogMarkdown, type BlogFrontmatter } from "./parse";

export type BlogPost = BlogFrontmatter & {
  body: string;
};

// Statically scoped so Turbopack traces content/blog rather than the whole repo.
// next dev/build and next start run with cwd apps/www (first path). Vitest and the
// standalone image (WORKDIR /app) use the monorepo path; the Dockerfile copies
// markdown to both locations.
const LOCAL_CONTENT_DIR = path.join(process.cwd(), "content", "blog");
const MONOREPO_CONTENT_DIR = path.join(process.cwd(), "apps", "www", "content", "blog");

export function getBlogContentDir(): string {
  if (fs.existsSync(LOCAL_CONTENT_DIR)) return LOCAL_CONTENT_DIR;
  if (fs.existsSync(MONOREPO_CONTENT_DIR)) return MONOREPO_CONTENT_DIR;
  throw new Error(
    `Blog content directory not found. Looked in: ${LOCAL_CONTENT_DIR}, ${MONOREPO_CONTENT_DIR}`,
  );
}

export function loadAllPosts(dir: string = getBlogContentDir()): BlogPost[] {
  // dir is resolved at runtime (apps/www vs monorepo root, or a test fixture).
  // Turbopack would otherwise trace the whole project; markdown is copied into
  // the image by the Dockerfile and outputFileTracingIncludes.
  const files = fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((name) => name.endsWith(".md"));
  const posts = files.map((name) => {
    const filePath = path.join(/*turbopackIgnore: true*/ dir, name);
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
    const parsed = parseBlogMarkdown(raw, filePath);
    return { ...parsed.frontmatter, body: parsed.body };
  });
  const slugs = new Set<string>();
  for (const post of posts) {
    if (slugs.has(post.slug)) {
      throw new Error(`Duplicate blog slug "${post.slug}"`);
    }
    slugs.add(post.slug);
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}

export function listPublishedPosts(now: Date = new Date(), dir?: string): BlogPost[] {
  return loadAllPosts(dir ?? getBlogContentDir()).filter((post) => isPostPublished(post.date, now));
}

export function getPublishedPost(slug: string, now: Date = new Date(), dir?: string): BlogPost | null {
  return listPublishedPosts(now, dir).find((post) => post.slug === slug) ?? null;
}
