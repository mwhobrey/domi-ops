#!/usr/bin/env node
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Local/CI default kept for backwards compatibility (matches HOSTED_TEST_DATABASE_URL in
// docs/HOSTED_TENANT_TESTS.md and ci.yml). Real deployments MUST set this — see
// deploy/HOSTED_BETA_SETUP.md "Before go-live".
const appPassword = (process.env.DOMI_OPS_APP_PASSWORD ?? "domi_ops_app").replace(/'/g, "''");

const sql = postgres(url, { max: 1 });

const statements = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domi_ops_app') THEN
    -- No NOSUPERUSER/NOBYPASSRLS clause: both are already Postgres's default for a brand-new
    -- role, and DigitalOcean's "doadmin" isn't a true superuser — even explicitly setting the
    -- *default* value on those clauses can hit "permission denied to alter role" on managed
    -- Postgres. Omitting them reaches the identical end state without touching that check.
    CREATE ROLE domi_ops_app LOGIN PASSWORD '${appPassword}';
  END IF;
END
$$;
ALTER ROLE domi_ops_app WITH LOGIN PASSWORD '${appPassword}';
GRANT CONNECT ON DATABASE domi_ops TO domi_ops_app;
GRANT USAGE ON SCHEMA public TO domi_ops_app;
GRANT USAGE ON SCHEMA app TO domi_ops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO domi_ops_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO domi_ops_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO domi_ops_app;

-- Drizzle's migrator (drizzle-orm/postgres-js/migrator) tracks applied migrations in
-- "drizzle"."__drizzle_migrations" (not schema "public"). The API/worker Docker image's
-- ENTRYPOINT runs migrate.js unconditionally on every boot — with DATABASE_URL pointed at
-- this restricted role in a real DEPLOYMENT_MODE=shared deploy, it needs read access to that
-- table so an already-fully-migrated boot sees "nothing pending" and just starts the server,
-- instead of failing closed with permission denied before ever reaching the app.
-- Run this script AFTER migrations have been applied (as the admin role) — this schema and
-- table must already exist, or these two grants below no-op nothing / error on a fresh DB.
GRANT USAGE ON SCHEMA drizzle TO domi_ops_app;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO domi_ops_app;
`;

try {
  await sql.unsafe(statements);
  console.log("domi_ops_app role ready (NOBYPASSRLS — use for test:hosted and hosted production)");
} finally {
  await sql.end();
}
