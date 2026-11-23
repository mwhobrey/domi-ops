import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketingShell, resolveMarketingUrls } from "@domi-ops/marketing-ui";
import { BlogMarkdown } from "@/components/BlogMarkdown";
import { formatPostDate, getPublishedPost } from "@/lib/blog";
import { SITE_URL } from "@/lib/faq";
import { pageSocial } from "@/lib/og";

type PostPageProps = {
  params: Promise<{ slug: string }>;
};

// Force request-time rendering so a 404 before the America/Chicago publish date
// is not cached as static HTML, and the post appears at midnight without a redeploy.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublishedPost(slug);
  if (!post) {
    return { title: "Post not found | Domi Ops" };
  }
  const title = `${post.title} | Domi Ops`;
  const path = `/blog/${post.slug}`;
  return {
    title,
    description: post.description,
    alternates: { canonical: post.canonicalUrl ?? path },
    ...pageSocial({
      title,
      description: post.description,
      path,
      type: "article",
      publishedTime: post.date,
    }),
  };
}

export default async function BlogPostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = getPublishedPost(slug);
  if (!post) notFound();

  const urls = resolveMarketingUrls();
  const canonical = post.canonicalUrl ?? `${SITE_URL}/blog/${post.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: canonical,
    mainEntityOfPage: canonical,
    author: post.author
      ? { "@type": "Person", name: post.author }
      : { "@type": "Organization", name: "Domi Ops" },
    publisher: { "@type": "Organization", name: "Domi Ops" },
  };

  return (
    <MarketingShell urls={urls}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-label text-[var(--color-accent)]">
          <Link href="/blog" className="hover:underline">
            Blog
          </Link>
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          {post.title}
        </h1>
        <time
          className="mt-4 block text-sm text-[var(--color-text-muted)]"
          dateTime={post.date}
        >
          {formatPostDate(post.date)}
        </time>
        <div className="mt-8">
          <BlogMarkdown body={post.body} />
        </div>
      </article>
    </MarketingShell>
  );
}
