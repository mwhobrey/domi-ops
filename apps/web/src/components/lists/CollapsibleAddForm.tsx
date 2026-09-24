"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui";

export function CollapsibleAddForm({
  label,
  collapseOnMobile = false,
  children,
}: {
  label: string;
  /** Collapse on small screens too — for pages where browsing, not adding, is the main job. */
  collapseOnMobile?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || !formRef.current) return;
    const focusable = formRef.current.querySelector<HTMLElement>(
      'input, select, textarea, [role="combobox"]',
    );
    focusable?.focus();
  }, [expanded]);

  return (
    <div>
      <div className={cn("mb-2", collapseOnMobile ? "flex" : "hidden md:flex")}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Cancel" : label}
        </Button>
      </div>
      <div
        ref={formRef}
        className={
          collapseOnMobile
            ? cn(!expanded && "hidden")
            : cn(expanded ? "md:block" : "md:hidden", "max-md:block")
        }
      >
        {children}
      </div>
    </div>
  );
}
