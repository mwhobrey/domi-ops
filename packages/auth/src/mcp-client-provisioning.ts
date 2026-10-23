import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { MCP_SCOPES, type McpAuthorization } from "./mcp.js";

export class McpProvisioningError extends Error {}
function fail(code: string): never { throw new McpProvisioningError(code); }
type Registration = Parameters<McpAuthorization["registerClient"]>[1];
export type McpClientPlan = { origin: string; registration: Registration; sha256: string };
const digest = (origin: string, registration: Registration) => createHash("sha256").update(JSON.stringify({ origin, registration })).digest("hex");

export async function readMcpOperatorFile(path: string, limit: number) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) fail("invalid_operator_file");
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) fail("invalid_operator_file");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await file.close(); }
}

export function planMcpClient(input: unknown, publicAppUrl: string): McpClientPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid_client_config");
  const config = input as Record<string, unknown>;
  if (Object.keys(config).some((key) => !["origin", "provider", "name", "redirectUri", "profileVersion", "scopes", "enabled"].includes(key))) fail("invalid_client_config");
  const canonical = new URL(publicAppUrl);
  if (canonical.protocol !== "https:" || canonical.username || canonical.password || canonical.search || canonical.hash || canonical.pathname !== "/" || config.origin !== canonical.origin) fail("canonical_origin_mismatch");
  if (typeof config.provider !== "string" || !["chatgpt", "claude", "gemini"].includes(config.provider)) fail("unsupported_household_provider");
  if (typeof config.name !== "string" || !config.name.trim() || config.name.length > 128 || /[\r\n]/.test(config.name)) fail("invalid_client_name");
  if (typeof config.profileVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.profileVersion)) fail("invalid_profile_version");
  if (typeof config.redirectUri !== "string") fail("invalid_provider_callback");
  const callback = new URL(config.redirectUri);
  if (callback.href !== config.redirectUri || callback.username || callback.password || callback.search || callback.hash ||
    (config.provider === "claude" ? callback.href !== "https://claude.ai/api/mcp/auth_callback" : config.provider === "gemini" ?
      callback.origin !== "https://oauth-redirect.googleusercontent.com" || !/^\/r\/[A-Za-z0-9_-]+$/.test(callback.pathname) :
      callback.origin !== "https://chatgpt.com" || !/^\/(?:connector\/oauth\/[A-Za-z0-9_-]+|connector_platform_oauth_redirect)$/.test(callback.pathname))) fail("invalid_provider_callback");
  if (!Array.isArray(config.scopes) || !config.scopes.length || new Set(config.scopes).size !== config.scopes.length ||
    config.scopes.some((scope) => typeof scope !== "string" || !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number])) ||
    !config.scopes.some((scope) => scope !== "offline_access")) fail("invalid_scopes");
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") fail("invalid_enabled_state");
  const registration: Registration = { name: config.name, provider: config.provider, profileVersion: config.profileVersion,
    redirectUris: [callback.href], tokenEndpointAuthMethod: "none", scopes: [...config.scopes].sort(), dataMode: "household", enabled: config.enabled ?? false };
  return { origin: canonical.origin, registration, sha256: digest(canonical.origin, registration) };
}

/** A receipt is an attempt journal: never delete/retry it automatically after an uncertain mutation. */
export async function provisionMcpClient(plan: McpClientPlan, options: {
  confirmPlan: string; cookieFile: string; receiptFile: string;
  register: (headers: Headers, input: Registration) => Promise<{ client_id: string }>;
}) {
  if (options.confirmPlan !== plan.sha256 || plan.sha256 !== digest(plan.origin, plan.registration)) fail("plan_confirmation_mismatch");
  const cookie = (await readMcpOperatorFile(options.cookieFile, 8192)).trim();
  if (!cookie || /[\r\n]/.test(cookie) || !cookie.includes("=") || /^cookie:/i.test(cookie)) fail("invalid_session_cookie_file");
  const receipt = await open(options.receiptFile, "wx", 0o600);
  const base = { version: 1, planSha256: plan.sha256, origin: plan.origin, provider: plan.registration.provider,
    profileVersion: plan.registration.profileVersion, enabled: plan.registration.enabled, attemptedAt: new Date().toISOString() };
  const serialize = (value: object) => JSON.stringify({ ...base, ...value }, null, 2) + "\n";
  try {
    await receipt.writeFile(serialize({ status: "attempting" }));
    await receipt.sync();
  } finally { await receipt.close(); }
  const record = async (value: object) => {
    const temporary = options.receiptFile + "." + randomUUID() + ".tmp";
    const next = await open(temporary, "wx", 0o600);
    try {
      try { await next.writeFile(serialize(value)); await next.sync(); }
      finally { await next.close(); }
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, options.receiptFile); break; }
        catch (error) {
          // Windows readers can briefly deny replacement. Retry only the file operation.
          if (process.platform !== "win32" || attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await setTimeout(25 * (attempt + 1));
        }
      }
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  };
  try {
    const client = await options.register(new Headers({ origin: plan.origin, cookie }), plan.registration);
    if (typeof client.client_id !== "string" || !client.client_id || client.client_id.length > 256) fail("invalid_registration_result");
    await record({ status: "registered", clientId: client.client_id });
    return { ...base, status: "registered", clientId: client.client_id };
  } catch {
    await record({ status: "uncertain", action: "inspect_before_retry" });
    fail("registration_uncertain_inspect_receipt");
  }
}
