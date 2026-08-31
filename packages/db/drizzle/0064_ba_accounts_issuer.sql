-- Better Auth 1.7+ added a required `issuer` match on account lookups (sign-in, password
-- update, findCredentialAccount - see node_modules/better-auth/dist/db/internal-adapter.mjs)
-- that this app's ba_accounts table never had a column for. Every account row this codebase
-- inserts manually (self-host /setup bootstrap, hosted Stripe-checkout signup, demo/QA seed
-- scripts) was missing it, which silently broke sign-in for every one of those accounts: the
-- row looks entirely correct (right user, right hashed password) but Better Auth's own
-- credential-account match can never find it, so every login attempt fails with "User not
-- found" / 401 INVALID_EMAIL_OR_PASSWORD regardless of password. Root-caused and confirmed live
-- 2026-08-31 (WHO-250).
--
-- Backfill matches better-auth/db's own createLocalAccountIssuer/createOAuthAccountIssuer
-- format ("local:<provider>" / "local:oauth:<provider>") for every existing row, not just
-- "credential" - covers any account created by this app's own manual insert sites before this
-- column existed, regardless of provider.

ALTER TABLE "ba_accounts" ADD COLUMN IF NOT EXISTS "issuer" text;

UPDATE "ba_accounts" SET "issuer" = 'local:' || provider_id
  WHERE "issuer" IS NULL AND provider_id = 'credential';

UPDATE "ba_accounts" SET "issuer" = 'local:oauth:' || provider_id
  WHERE "issuer" IS NULL AND provider_id <> 'credential';
