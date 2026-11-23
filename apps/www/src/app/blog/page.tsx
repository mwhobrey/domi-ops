import Link from "next/link";
import { MarketingShell, resolveMarketingUrls } from "@domi-ops/marketing-ui";
import { formatPostDate, listPublishedPosts } from "@/lib/blog";
import { pageSocial } from "@/lib/og";

const TITLE = "Blog | Domi Ops";
const DESCRIPTION =
  "Notes from Domi Ops on household coordination, medications, and the work of keeping a home on track.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  ...pageSocial({ title: TITLE, description: DESCRIPTION, path: "/blog" }),
};

// Date-gating must run at request time. A static build on a day before a post's
// America/Chicago date would otherwise freeze an empty index until the next deploy.
export const dynamic = "force-dynamic";

export default function BlogIndexPage() {
  const urls = resolveMarketingUrls();
  const posts = listPublishedPosts();

  return (
    <MarketingShell urls={urls}>
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-label text-[var(--color-accent)]">Blog</p>
        <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          From the Domi Ops team
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-text-muted)]">
          Practical notes on household coordination and the health side of the day.
        </p>
        {posts.length === 0 ? (
          <p className="mt-10 text-lg leading-relaxed text-[var(--color-text-muted)]">
            New posts will show up here when they are published.
          </p>
        ) : (
          <ul className="mt-10 space-y-8">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`} className="group block">
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-text)] group-hover:text-[var(--color-accent)]">
                    {post.title}
                  </h2>
                  <time
                    className="mt-2 block text-sm text-[var(--color-text-muted)]"
                    dateTime={post.date}
                  >
                    {formatPostDate(post.date)}
                  </time>
                  <p className="mt-3 text-base leading-relaxed text-[var(--color-text-muted)]">
                    {post.description}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MarketingShell>
  );
}
