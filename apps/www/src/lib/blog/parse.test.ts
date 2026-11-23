import { describe, expect, it } from "vitest";
import { parseBlogMarkdown } from "./parse";

const SAMPLE = `---
title: "National Caregivers Day: Caregiving Is Also Coordination"
slug: national-caregivers-day-coordination
date: 2027-02-19
description: "Friday, February 19, 2027 is National Caregivers Day."
tags: [national-caregivers-day, caregiving]
canonical_url: https://domi-ops.com/blog/national-caregivers-day-coordination
---

# National Caregivers Day: Caregiving Is Also Coordination

By Mike Whobrey

Body paragraph.
`;

describe("parseBlogMarkdown", () => {
  it("reads required frontmatter and keeps optional fields", () => {
    const parsed = parseBlogMarkdown(SAMPLE, "sample.md");
    expect(parsed.frontmatter).toEqual({
      title: "National Caregivers Day: Caregiving Is Also Coordination",
      slug: "national-caregivers-day-coordination",
      date: "2027-02-19",
      description: "Friday, February 19, 2027 is National Caregivers Day.",
      tags: ["national-caregivers-day", "caregiving"],
      canonicalUrl: "https://domi-ops.com/blog/national-caregivers-day-coordination",
    });
  });

  it("strips a leading H1 that matches the title so the page does not render it twice", () => {
    const parsed = parseBlogMarkdown(SAMPLE, "sample.md");
    expect(parsed.body.startsWith("By Mike Whobrey")).toBe(true);
    expect(parsed.body).not.toMatch(/^# /);
  });

  it("keeps a leading H1 that does not match the title", () => {
    const parsed = parseBlogMarkdown(
      `---
title: Hello
slug: hello
date: 2026-01-01
description: A post
---

# A different heading

Text.
`,
      "other.md",
    );
    expect(parsed.body.startsWith("# A different heading")).toBe(true);
  });

  it("rejects missing frontmatter, missing fields, and bad slugs or dates", () => {
    expect(() => parseBlogMarkdown("# just a title\n", "none.md")).toThrow(/Missing YAML frontmatter/);
    expect(() =>
      parseBlogMarkdown(
        `---
title: Hello
slug: Hello World
date: 2026-01-01
description: A post
---
`,
        "slug.md",
      ),
    ).toThrow(/Invalid slug/);
    expect(() =>
      parseBlogMarkdown(
        `---
title: Hello
slug: hello
date: 2026-13-01
description: A post
---
`,
        "date.md",
      ),
    ).toThrow(/Invalid blog date/);
    expect(() =>
      parseBlogMarkdown(
        `---
slug: hello
date: 2026-01-01
description: A post
---
`,
        "title.md",
      ),
    ).toThrow(/Missing title/);
  });
});
