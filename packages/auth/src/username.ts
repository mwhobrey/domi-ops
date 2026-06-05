/** Aligns with Better Auth username plugin defaults. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsernameFormat(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "Username may only contain letters, numbers, underscores, and periods";
  }
  return null;
}
