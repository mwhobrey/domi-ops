import { apiFetch } from "../lib/api";
import { memberShownLabel } from "../lib/member-label";
import { AppChrome, type ShellUser } from "./AppChrome";
import { PageHeader } from "./ui";

export async function AppShell({
  children,
  title,
  description,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  let user: ShellUser | null = null;
  try {
    const session = await apiFetch<{
      authenticated: boolean;
      user?: {
        email: string;
        name: string | null;
        nickname: string | null;
        publicLabel: "name" | "nickname";
      };
    }>("/auth/session");
    if (session.authenticated && session.user) {
      const u = session.user;
      user = {
        email: u.email,
        name: u.name,
        nickname: u.nickname,
        shownLabel: memberShownLabel({
          name: u.name,
          nickname: u.nickname,
          publicLabel: u.publicLabel,
        }),
      };
    }
  } catch {
    /* */
  }

  return (
    <AppChrome user={user}>
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </AppChrome>
  );
}
