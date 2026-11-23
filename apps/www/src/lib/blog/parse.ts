import { parseDateOnly } from "./date";

export type BlogFrontmatter = {
  title: string;
  slug: string;
  date: string;
  description: string;
  tags?: string[];
  canonicalUrl?: string;
  author?: string;
};

export type ParsedBlogDocument = {
  frontmatter: BlogFrontmatter;
  body: string;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseBlogMarkdown(raw: string, source = "document"): ParsedBlogDocument {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) {
    throw new Error(`Missing YAML frontmatter in ${source}`);
  }
  const data = parseSimpleYaml(match[1], source);
  const frontmatter = validateFrontmatter(data, source);
  const body = stripMatchingTitleHeading(match[2].trim(), frontmatter.title);
  return { frontmatter, body };
}

function validateFrontmatter(data: Record<string, unknown>, source: string): BlogFrontmatter {
  const title = requiredString(data, "title", source);
  const slug = requiredString(data, "slug", source);
  const date = requiredString(data, "date", source);
  const description = requiredString(data, "description", source);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid slug "${slug}" in ${source}; expected lowercase kebab-case`);
  }
  parseDateOnly(date);

  const frontmatter: BlogFrontmatter = { title, slug, date, description };
  if (data.tags !== undefined) {
    frontmatter.tags = Array.isArray(data.tags)
      ? data.tags.map((tag, index) => {
          if (typeof tag !== "string" || tag.trim() === "") {
            throw new Error(`Invalid tags[${index}] in ${source}`);
          }
          return tag;
        })
      : (() => {
          throw new Error(`Invalid tags in ${source}; expected a list`);
        })();
  }
  const canonicalUrl = optionalString(data, "canonical_url", source) ?? optionalString(data, "canonicalUrl", source);
  if (canonicalUrl) frontmatter.canonicalUrl = canonicalUrl;
  const author = optionalString(data, "author", source);
  if (author) frontmatter.author = author;
  return frontmatter;
}

function requiredString(data: Record<string, unknown>, key: string, source: string): string {
  const value = optionalString(data, key, source);
  if (!value) {
    throw new Error(`Missing ${key} in ${source} frontmatter`);
  }
  return value;
}

function optionalString(data: Record<string, unknown>, key: string, source: string): string | undefined {
  const value = data[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${key} in ${source} frontmatter`);
  }
  return value.trim();
}

function stripMatchingTitleHeading(body: string, title: string): string {
  const heading = /^#\s+(.+?)\s*(?:\n+|$)/.exec(body);
  if (heading && heading[1].trim() === title) {
    return body.slice(heading[0].length).trim();
  }
  return body;
}

function parseSimpleYaml(yaml: string, source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) {
      throw new Error(`Invalid frontmatter line "${line}" in ${source}`);
    }
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    if (!key) {
      throw new Error(`Invalid frontmatter line "${line}" in ${source}`);
    }
    result[key] = parseYamlValue(rawValue);
  }
  return result;
}

function parseYamlValue(rawValue: string): unknown {
  if (rawValue === "") return "";
  if (rawValue === "[]") return [];
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    const inner = rawValue.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => unquote(item.trim()));
  }
  return unquote(rawValue);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    const quote = value[0];
    return value
      .slice(1, -1)
      .replaceAll(`\\${quote}`, quote)
      .replaceAll("\\\\", "\\");
  }
  return value;
}
