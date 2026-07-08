/** Mirrors @domi-ops/config ALLOW_PUBLIC_SIGNUP default (no DB read). */
export function isPublicSignupAllowed(): boolean {
  const v = process.env.ALLOW_PUBLIC_SIGNUP;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV !== "production";
}
