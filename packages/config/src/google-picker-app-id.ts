/**
 * Google Picker `setAppId` expects the GCP **project number** (digits only),
 * not the OAuth client ID string.
 *
 * Web client IDs are usually `{projectNumber}-{suffix}.apps.googleusercontent.com`.
 */
export function googlePickerAppId(opts: {
  projectNumber?: string | null;
  oauthClientId?: string | null;
}): string | null {
  const explicit = opts.projectNumber?.trim();
  if (explicit && /^\d+$/.test(explicit)) return explicit;

  const clientId = opts.oauthClientId?.trim();
  if (!clientId) return null;
  const match = /^(\d+)-/.exec(clientId);
  return match?.[1] ?? null;
}
