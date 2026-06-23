"use client";

import { BarChart3 } from "lucide-react";
import { LinkButton } from "../ui";
import type { ReportModule } from "../../lib/reports";
import { reportsHubUrl } from "../../lib/reports";

export function ModuleReportsLink({
  module,
  href,
  label = "Reports",
}: {
  module: ReportModule;
  href?: string;
  label?: string;
}) {
  return (
    <LinkButton href={href ?? reportsHubUrl(module)} variant="ghost" size="sm">
      <BarChart3 className="h-4 w-4" aria-hidden />
      {label}
    </LinkButton>
  );
}
