#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadEnv, mcpSupportedScopes } from "@domi-ops/config";
import { createDb, closeDb } from "@domi-ops/db";
import { sql } from "drizzle-orm";
import { createBetterAuth } from "./better-auth.js";
import { McpProvisioningError, planMcpClient, provisionMcpClient, readMcpOperatorFile } from "./mcp-client-provisioning.js";

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" }, apply: { type: "boolean" },
    "confirm-plan": { type: "string" }, "cookie-file": { type: "string" }, "receipt-file": { type: "string" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("Usage: mcp:client --config FILE [--apply --confirm-plan SHA256 --cookie-file PRIVATE_FILE --receipt-file NEW_PRIVATE_FILE]\nDefault: validate and print a plan without connecting to a database. Apply uses the target deployment environment, restricted DB role and an existing member session. Public ChatGPT/Claude/Gemini household clients only; no consent or household enablement.");
    return;
  }
  if (!values.config) throw new McpProvisioningError("config_file_required");
  const env = loadEnv();
  const plan = planMcpClient(JSON.parse(await readMcpOperatorFile(values.config, 16384)), env.PUBLIC_APP_URL, mcpSupportedScopes(env));
  if (!values.apply) {
    console.log(JSON.stringify({ mode: "plan", sha256: plan.sha256, origin: plan.origin, provider: plan.registration.provider,
      profileVersion: plan.registration.profileVersion, scopes: plan.registration.scopes, enabled: plan.registration.enabled,
      callbackOrigin: new URL(plan.registration.redirectUris[0]).origin }, null, 2));
    return;
  }
  if (!values["confirm-plan"] || !values["cookie-file"] || !values["receipt-file"]) throw new McpProvisioningError("apply_arguments_required");
  if (!env.MCP_ENABLED || env.MCP_SYNTHETIC_DEPLOYMENT || env.DEMO_MODE) throw new McpProvisioningError("household_deployment_required");
  let db: ReturnType<typeof createDb> | undefined;
  try {
    const result = await provisionMcpClient(plan, { confirmPlan: values["confirm-plan"], cookieFile: values["cookie-file"], receiptFile: values["receipt-file"],
      register: async (headers, input) => {
        db = createDb(env.DATABASE_URL);
        const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname=current_user`);
        if (!role || role.rolsuper || role.rolbypassrls) throw new McpProvisioningError("restricted_app_role_required");
        return createBetterAuth(db, env).mcp.registerClient(headers, input);
      } });
    console.log(JSON.stringify(result));
  } finally { if (db) await closeDb(db); }
}

main().catch((error: unknown) => {
  // Provider/SQL/file errors can contain credentials; never echo arbitrary errors.
  console.error(error instanceof McpProvisioningError ? error.message : "mcp_client_operation_failed_inspect_private_receipt");
  process.exitCode = 1;
});
