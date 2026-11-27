import type { Metadata } from "next";
import { pageSocial } from "./og";

/**
 * Document title, description, canonical URL and matching Open Graph / Twitter tags for one page,
 * so a share of the page does not fall back to the homepage card text from the root layout.
 */
export function pageMetadata(opts: { title: string; description: string; path: string }): Metadata {
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    ...pageSocial(opts),
  };
}

export const ABOUT_METADATA = pageMetadata({
  title: "Our story | Domi Ops",
  description:
    "Why Mike Whobrey built Domi Ops: a homeschooling family that needed school records, a reliable calendar, and health tracking that fits a complicated medication schedule.",
  path: "/about",
});

export const PRIVACY_METADATA = pageMetadata({
  title: "Privacy Policy | Domi Ops",
  description:
    "How Domi Ops handles household data: what is stored, how Health data is protected, which processors are used, and how to export or delete your data.",
  path: "/privacy",
});

export const TERMS_METADATA = pageMetadata({
  title: "Terms of Service | Domi Ops",
  description:
    "The terms for using Domi Ops Cloud and self-host: accounts, acceptable use, payments and trial, and the service level.",
  path: "/terms",
});
