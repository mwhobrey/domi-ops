#!/usr/bin/env node
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const statements = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domi_ops_app') THEN
    CREATE ROLE domi_ops_app LOGIN PASSWORD 'domi_ops_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE domi_ops_app WITH LOGIN PASSWORD 'domi_ops_app' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE domi_ops TO domi_ops_app;
GRANT USAGE ON SCHEMA public TO domi_ops_app;
GRANT USAGE ON SCHEMA app TO domi_ops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO domi_ops_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO domi_ops_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO domi_ops_app;
`;

try {
  await sql.unsafe(statements);
  console.log("domi_ops_app role ready (NOBYPASSRLS — use for test:hosted)");
} finally {
  await sql.end();
}
