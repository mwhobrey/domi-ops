import { describe, expect, it } from "vitest";
import { OG_IMAGES } from "./og";
import { ABOUT_METADATA, PRIVACY_METADATA, TERMS_METADATA } from "./page-metadata";

const pages = [
  { metadata: ABOUT_METADATA, title: "Our story | Domi Ops", path: "/about" },
  { metadata: PRIVACY_METADATA, title: "Privacy Policy | Domi Ops", path: "/privacy" },
  { metadata: TERMS_METADATA, title: "Terms of Service | Domi Ops", path: "/terms" },
];

describe("about, privacy and terms metadata", () => {
  it.each(pages)("$path sets its own title, canonical and share tags", ({ metadata, title, path }) => {
    const og = metadata.openGraph as { title: string; url: string; description: string; images: { url: string }[] };
    const twitter = metadata.twitter as { title: string; description: string; card: string };

    expect(metadata.title).toBe(title);
    expect(typeof metadata.description).toBe("string");
    expect(metadata.alternates?.canonical).toBe(path);
    expect(og.title).toBe(title);
    expect(og.url).toBe(path);
    expect(og.description).toBe(metadata.description);
    expect(og.images[0].url).toBe(OG_IMAGES.default.path);
    expect(twitter.title).toBe(title);
    expect(twitter.description).toBe(metadata.description);
    expect(twitter.card).toBe("summary_large_image");
  });

  it("does not reuse the homepage card text", () => {
    for (const { metadata } of pages) {
      const og = metadata.openGraph as { title: string; description: string };
      expect(og.title).not.toContain("The household hub for homeschool families");
      expect(og.description).not.toContain("Homeschool gradebook, family calendar");
    }
  });
});
