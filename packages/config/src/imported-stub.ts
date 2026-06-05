/** Placeholder emails for HomeHub import stubs — claimed on real login. */
export const IMPORTED_STUB_EMAIL_DOMAIN = "imported.local";

export function slugLegacyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "member";
}

export function importedStubEmail(legacyName: string, sourceId: string): string {
  return `${slugLegacyName(legacyName)}-${sourceId}@${IMPORTED_STUB_EMAIL_DOMAIN}`;
}

export function isImportedStubEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${IMPORTED_STUB_EMAIL_DOMAIN}`);
}
