"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui";

export function CollapsibleAddForm({
  label,
  children,
}: {
  label: string;
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
      <div className="mb-2 hidden md:flex">
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
      <div ref={formRef} className={cn(expanded ? "md:block" : "md:hidden", "max-md:block")}>
        {children}
      </div>
    </div>
  );
}
