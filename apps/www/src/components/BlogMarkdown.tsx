import type { Components } from "react-markdown";
import Markdown from "react-markdown";

function isExternalHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, "https://domi-ops.com");
    return url.origin !== "https://domi-ops.com";
  } catch {
    return false;
  }
}

const components: Components = {
  a({ href, children }) {
    const external = isExternalHref(href);
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
};

export function BlogMarkdown({ body }: { body: string }) {
  return (
    <div className="blog-prose">
      <Markdown components={components}>{body}</Markdown>
    </div>
  );
}
