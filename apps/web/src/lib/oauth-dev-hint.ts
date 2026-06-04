/** Actionable copy when Google OAuth fails in local dev (WHO-14 / calendar connect). */
export function oauthFailureHint(publicAppUrl: string): string {
  return `Google rejected the redirect. Open the app at ${publicAppUrl} (must match PUBLIC_APP_URL in .env) and register both callback URLs in Google Cloud — see docs/GOOGLE_OAUTH_SETUP.md.`;
}
