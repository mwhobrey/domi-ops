import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPublishedPosts, type BlogPost } from "./posts";
import { buildRssFeed, escapeXml, toRssPubDate } from "./rss";

const posts: BlogPost[] = [
  {
    title: "Alpha & Friends",
    slug: "alpha",
    date: "2026-11-23",
    description: 'Notes with <tags> & "quotes"',
    author: "Mike Whobrey",
    tags: ["household", "intro"],
    body: "unused",
  },
  {
    title: "Beta",
    slug: "beta",
    date: "2026-10-01",
    description: "Earlier post",
    canonicalUrl: "https://example.com/beta",
    body: "unused",
  },
];

const fixtures: string[] = [];

function writeFixture(entries: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-ops-rss-"));
  fixtures.push(dir);
  for (const [name, contents] of Object.entries(entries)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const doc = (slug: string, date: string) => `---
title: ${slug}
slug: ${slug}
date: ${date}
description: About ${slug}.
---

Body.
`;

function itemLinks(xml: string): string[] {
  return [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((match) => match[1]);
}

describe("escapeXml", () => {
  it("escapes markup-sensitive characters", () => {
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  });
});

describe("toRssPubDate", () => {
  it("uses America/Chicago midnight as the publish instant", () => {
    expect(toRssPubDate("2026-11-23")).toBe("Mon, 23 Nov 2026 06:00:00 GMT");
    expect(toRssPubDate("2026-07-04")).toBe("Sat, 04 Jul 2026 05:00:00 GMT");
  });
});

describe("buildRssFeed", () => {
  it("emits RSS 2.0 with escaped fields, author, categories and canonical links", () => {
    const xml = buildRssFeed({ siteUrl: "https://domi-ops.com", posts });

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>Domi Ops Blog</title>");
    expect(xml).toContain("<link>https://domi-ops.com/blog</link>");
    expect(xml).toContain(
      '<atom:link href="https://domi-ops.com/blog/rss.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(xml).toContain("<title>Alpha &amp; Friends</title>");
    expect(xml).toContain("<description>Notes with &lt;tags&gt; &amp; &quot;quotes&quot;</description>");
    expect(xml).toContain('<guid isPermaLink="true">https://domi-ops.com/blog/alpha</guid>');
    expect(xml).toContain("<dc:creator>Mike Whobrey</dc:creator>");
    expect(xml).toContain("<category>household</category>");
    expect(xml).toContain("<pubDate>Mon, 23 Nov 2026 06:00:00 GMT</pubDate>");
    expect(xml).toContain("<lastBuildDate>Mon, 23 Nov 2026 06:00:00 GMT</lastBuildDate>");
    expect(itemLinks(xml)).toEqual(["https://domi-ops.com/blog/alpha", "https://example.com/beta"]);
    expect(xml).not.toContain("unused");
    // No raw markup from frontmatter leaks into the document.
    expect(xml).not.toMatch(/<tags>|& /);
  });

  it("still produces a valid empty channel", () => {
    const xml = buildRssFeed({ siteUrl: "https://domi-ops.com/", posts: [] });
    expect(xml).toContain("<link>https://domi-ops.com/blog</link>");
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });

  it("omits a future post until America/Chicago midnight on its date", () => {
    const dir = writeFixture({
      "published.md": doc("published", "2026-11-23"),
      "future.md": doc("future", "2027-02-19"),
    });
    const feedAt = (iso: string) =>
      itemLinks(buildRssFeed({ siteUrl: "https://domi-ops.com", posts: listPublishedPosts(new Date(iso), dir) }));

    expect(feedAt("2026-11-24T15:00:00.000Z")).toEqual(["https://domi-ops.com/blog/published"]);
    // UTC midnight is still Feb 18 in Chicago.
    expect(feedAt("2027-02-19T00:00:00.000Z")).toEqual(["https://domi-ops.com/blog/published"]);
    expect(feedAt("2027-02-19T05:59:59.999Z")).toEqual(["https://domi-ops.com/blog/published"]);
    expect(feedAt("2027-02-19T06:00:00.000Z")).toEqual([
      "https://domi-ops.com/blog/future",
      "https://domi-ops.com/blog/published",
    ]);
  });

  it("keeps the real Caregivers Day post out of a feed built before February 19, 2027", () => {
    const xml = buildRssFeed({
      siteUrl: "https://domi-ops.com",
      posts: listPublishedPosts(new Date("2026-11-24T15:00:00.000Z")),
    });
    expect(xml).toContain("<link>https://domi-ops.com/blog/why-i-built-domi-ops</link>");
    expect(xml).not.toContain("national-caregivers-day-coordination");
  });
});
