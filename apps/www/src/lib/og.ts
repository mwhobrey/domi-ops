import type { Metadata } from "next";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** Card art lives in public/og (1200x630). Add a variant here when a page earns its own. */
export const OG_IMAGES = {
  default: { path: "/og/og-default.png", alt: "Domi Ops, the household hub for homeschool families, with dashboard and calendar screens" },
  health: { path: "/og/og-health.png", alt: "Domi Ops health tracking: medications, scheduled checks, reminders and reports" },
} as const;

/** A same-origin 1200x630 image, such as a generated per-post card. */
export type SocialImage = { path: string; alt: string };

/**
 * Open Graph and Twitter tags for one page. A page-level `openGraph` replaces the layout's rather
 * than merging, so each page that sets its own title has to bring its own image and url too.
 */
export function pageSocial(opts: {
  title: string;
  description: string;
  path: string;
  image?: keyof typeof OG_IMAGES | SocialImage;
  type?: "website" | "article";
  publishedTime?: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const img = typeof opts.image === "object" ? opts.image : OG_IMAGES[opts.image ?? "default"];
  const images = [{ url: img.path, ...OG_IMAGE_SIZE, alt: img.alt }];
  const type = opts.type ?? "website";
  return {
    openGraph: {
      type,
      siteName: "Domi Ops",
      locale: "en_US",
      title: opts.title,
      description: opts.description,
      url: opts.path,
      images,
      ...(type === "article" && opts.publishedTime ? { publishedTime: opts.publishedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: images.map((i) => ({ url: i.url, alt: i.alt })),
    },
  };
}
