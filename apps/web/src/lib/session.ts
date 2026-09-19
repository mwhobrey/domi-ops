/** Shape returned by GET `/auth/session` (web BFF). */
export type AuthSessionResponse = {
  authenticated?: boolean;
  modulesEnabled?: string[];
  telemetryOptIn?: boolean;
  user?: {
    email?: string | null;
    username?: string | null;
    memberId?: string;
    name?: string | null;
    avatarUrl?: string | null;
    role?: string;
  };
  /** @deprecated Prefer `user.memberId` */
  memberId?: string;
  /** @deprecated Prefer `user.role` */
  role?: string;
};

export function sessionMemberId(session: AuthSessionResponse): string {
  return session.user?.memberId ?? session.memberId ?? "";
}

export function sessionRole(session: AuthSessionResponse): string {
  return session.user?.role ?? session.role ?? "member";
}
