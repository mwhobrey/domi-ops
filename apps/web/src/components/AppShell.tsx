import { apiFetch } from "../lib/api";
import { memberShownLabel } from "../lib/member-label";
import { Suspense } from "react";
import { AppChrome, type ShellUser } from "./AppChrome";
import { NoticeBoardActions } from "./NoticeBoard";
import { Breadcrumb, type BreadcrumbItem, PageHeader } from "./ui";

export async function AppShell({
  children,
  title,
  description,
  actions,
  breadcrumb,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
}) {
  let user: ShellUser | null = null;
  try {
    const session = await apiFetch<{
      authenticated: boolean;
      user?: {
        email: string | null;
        username?: string | null;
        memberId: string;
        name: string | null;
        avatarUrl: string | null;
      };
    }>("/auth/session");
    if (session.authenticated && session.user) {
      const u = session.user;
      user = {
        email: u.email,
        username: u.username ?? null,
        memberId: u.memberId,
        name: u.name,
        shownLabel: memberShownLabel({ name: u.name }),
        avatarUrl: u.avatarUrl,
      };
    }
  } catch {
    /* */
  }

  return (
    <AppChrome user={user}>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Suspense fallback={null}>
              <NoticeBoardActions />
            </Suspense>
            {actions}
          </>
        }
      />
      {children}
    </AppChrome>
  );
}
