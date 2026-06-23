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
  try {
    const session = await apiFetch<{
      authenticated: boolean;
      modulesEnabled?: string[];
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

  return (
    <AppChrome user={user} modulesEnabled={modulesEnabled}>
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
