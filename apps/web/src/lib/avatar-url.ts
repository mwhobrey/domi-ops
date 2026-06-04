/** Same-origin avatar image (session cookie sent via Next rewrite). */
export function memberAvatarUrl(memberId: string, hasAvatar: boolean): string | null {
  return hasAvatar ? `/api/core/avatars/${memberId}` : null;
}
