import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPublishedPost, listPublishedPosts, loadAllPosts } from "./posts";

const fixtures: string[] = [];

function writeFixture(entries: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-ops-blog-"));
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

const future = `---
title: Future Post
slug: future-post
date: 2027-02-19
description: Not yet.
---

# Future Post

Hidden for now.
`;

const past = `---
title: Already Out
slug: already-out
date: 2026-01-15
description: Published earlier.
---

# Already Out

Visible.
`;

describe("published post helpers", () => {
  it("loads every document but only lists and returns published posts", () => {
    const dir = writeFixture({
      "future-post.md": future,
      "already-out.md": past,
    });
    const all = loadAllPosts(dir);
    expect(all.map((post) => post.slug)).toEqual(["future-post", "already-out"]);

    const now = new Date("2026-11-23T16:00:00.000Z");
    const published = listPublishedPosts(now, dir);
    expect(published.map((post) => post.slug)).toEqual(["already-out"]);
    expect(getPublishedPost("already-out", now, dir)?.title).toBe("Already Out");
    expect(getPublishedPost("future-post", now, dir)).toBeNull();
  });

  it("includes a post at Chicago midnight on its date", () => {
    const dir = writeFixture({ "future-post.md": future });
    const justBefore = new Date("2027-02-19T05:59:59.000Z");
    const atMidnight = new Date("2027-02-19T06:00:00.000Z");
    expect(getPublishedPost("future-post", justBefore, dir)).toBeNull();
    expect(getPublishedPost("future-post", atMidnight, dir)?.slug).toBe("future-post");
  });

  it("reads the real Caregivers Day draft as unpublished before February 19, 2027", () => {
    const now = new Date("2026-11-23T16:00:00.000Z");
    expect(getPublishedPost("national-caregivers-day-coordination", now)).toBeNull();
    expect(listPublishedPosts(now).some((post) => post.slug === "national-caregivers-day-coordination")).toBe(
      false,
    );
    const live = getPublishedPost(
      "national-caregivers-day-coordination",
      new Date("2027-02-19T00:00:00.000-06:00"),
    );
    expect(live?.title).toBe("National Caregivers Day: Caregiving Is Also Coordination");
    expect(live?.body).toContain("By Mike Whobrey");
    expect(live?.body).not.toMatch(/^# /);
  });
});
