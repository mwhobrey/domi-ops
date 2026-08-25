import { apiFetch } from "../lib/api";
import { memberShownLabel } from "../lib/member-label";
import { AppChrome, type ShellUser } from "./AppChrome";
import { Breadcrumb, type BreadcrumbItem, PageHeader } from "./ui";

export async function AppShell({
  children,
  title,
  description,
  descriptionVisibility,
  actions,
  breadcrumb,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
  descriptionVisibility?: "always" | "desktop" | "never";
  actions?: React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
}) {
  let user: ShellUser | null = null;
  let modulesEnabled: string[] | undefined;
  let telemetryOptIn = false;
  try {
    const session = await apiFetch<{
      authenticated: boolean;
      modulesEnabled?: string[];
      telemetryOptIn?: boolean;
      user?: {
        email: string | null;
        username?: string | null;
        memberId: string;
        name: string | null;
        avatarUrl: string | null;
        role?: string;
      };
    }>("/auth/session");
    if (session.authenticated && session.user) {
      modulesEnabled = session.modulesEnabled;
      telemetryOptIn = session.telemetryOptIn ?? false;
      const u = session.user;
      user = {
        email: u.email,
        username: u.username ?? null,
        memberId: u.memberId,
        name: u.name,
        shownLabel: memberShownLabel({ name: u.name }),
        avatarUrl: u.avatarUrl,
        role: u.role,
      };
    }
  } catch {
    /* */
  }

  const resolvedDescriptionVisibility =
    descriptionVisibility ?? (description ? "desktop" : "never");

  const telemetry = {
    enabled: telemetryOptIn,
    // Same central collector for both self-host and hosted — operator-overridable via
    // TELEMETRY_ENDPOINT in .env; read server-side so it's runtime-configurable, not
    // baked into the client bundle at Docker build time (that would break self-host
    // operators trying to point it anywhere non-default, or disable it downstream).
    endpoint: process.env.TELEMETRY_ENDPOINT ?? "https://app.domi-ops.com/api/telemetry",
    deploymentMode: process.env.DEPLOYMENT_MODE ?? "single",
  };

  return (
    <AppChrome user={user} modulesEnabled={modulesEnabled} telemetry={telemetry}>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <PageHeader
        title={title}
        description={description}
        descriptionVisibility={resolvedDescriptionVisibility}
        actions={actions}
      />
      {children}
    </AppChrome>
  );
}
