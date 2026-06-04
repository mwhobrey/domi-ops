export function memberAvatarUrl(memberId: string, avatarKey: string | null | undefined): string | null {
  return avatarKey ? `/api/core/avatars/${memberId}` : null;
}
