import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnership } from "../hosted-qa/ownership.mjs";
import { mcpOrigin } from "../hosted-qa/mcp-origin.mjs";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const directory = join(root, ".qa", "hosted"), state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
const project = `domi-ops-qa-${createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 10)}`;
assertOwnership(state, root, project);
assert.ok(state.mcp && state.mode === "fixture", "Synthetic MCP lab required");
const container = `${project}-providers-1`;
const [inspected] = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }));
assert.equal(inspected.Config.Labels["com.docker.compose.project"], project);
const config = JSON.parse(execFileSync("docker", ["exec", container, "cat", "/qa/mcp.json"], { encoding: "utf8" }));
const origin = mcpOrigin(state.mcpOrigin ?? `http://localhost:${state.ports.web}`, state.ports.web).origin; assert.equal(config.origin, origin);
const fixtureResponse = await fetch(`http://localhost:${state.ports.provider}/__qa/fixtures`, { headers: { "x-qa-token": state.secrets.TOKEN }, signal: AbortSignal.timeout(10000) });
assert.ok(fixtureResponse.ok, "Owned fixture lookup failed");
const fixture = await fixtureResponse.json(), owner = fixture.households.find((household) => household.label === "alpha");
const scopes = ["shopping:read", "chores:read", "notes:read", "offline_access"];
let cookie, connectionId;
async function request(path, body, extra = {}) {
  const target = new URL(path, origin); assert.equal(target.origin, origin);
  return fetch(target, { method: body === undefined ? "GET" : "POST", headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual", signal: AbortSignal.timeout(15000) });
}
async function json(path, body, extra) {
  const response = await request(path, body, extra); assert.ok(response.ok, `Request failed: ${new URL(path, origin).pathname} (${response.status})`); return response.json();
}
async function tokens(fields) {
  const response = await fetch(origin + "/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams({ client_id: config.clientId, resource: origin + "/api/mcp", ...fields }), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, "Token exchange failed"); return response.json();
}
let sequence = 0;
async function rpc(token, method, params = {}) {
  const response = await request("/api/mcp", { jsonrpc: "2.0", id: ++sequence, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "local-synthetic-smoke", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }, { authorization: "Bearer " + token, accept: "application/json, text/event-stream", "mcp-method": method, "mcp-protocol-version": "2026-07-28", ...(params.name ? { "mcp-name": params.name } : {}) });
  assert.equal(response.status, 200, "Authenticated MCP failed"); const body = await response.json(); assert.equal(body.result?.isError, undefined); assert.equal(body.error, undefined); return body.result;
}
const stages = [];
try {
  const metadata = await json("/.well-known/oauth-protected-resource/api/mcp"); assert.equal(metadata.resource, origin + "/api/mcp");
  const authorization = await json("/.well-known/oauth-authorization-server/auth"); assert.equal(authorization.issuer, origin + "/auth"); assert.ok(authorization.code_challenge_methods_supported.includes("S256"));
  const unauthenticated = await request("/api/mcp", {}); assert.equal(unauthenticated.status, 401); assert.ok(unauthenticated.headers.get("www-authenticate").includes("resource_metadata")); stages.push("discovery_and_bearer_challenge");
  const login = await request("/auth/sign-in/email", { email: owner.email, password: fixture.password }); assert.ok(login.ok, "Synthetic login failed");
  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "); assert.ok(cookie);
  const verifier = randomBytes(48).toString("base64url");
  const query = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.callback, scope: scopes.join(" "), resource: origin + "/api/mcp", state: randomBytes(16).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const begin = await request("/auth/oauth2/authorize?" + query);
  const location = begin.headers.get("location") ?? (await begin.json()).url;
  const consent = new URL(location, origin); assert.equal(consent.origin, origin); assert.equal(consent.pathname, "/ai/consent");
  const oauthQuery = consent.searchParams.toString();
  const preview = await json("/api/mcp-auth/consents/preview", { householdId: owner.householdId, oauthQuery });
  assert.equal(typeof preview.policyVersion, "string");
  const pending = await json("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery, noteIds: [config.noteId], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: preview.policyVersion });
  const accepted = await json("/api/mcp-auth/consents/decide", { pendingId: pending.pendingId, oauthQuery, accept: true }); connectionId = accepted.connectionId;
  const redirect = new URL(accepted.redirectUri); assert.equal(redirect.origin, new URL(config.callback).origin);
  const token = await tokens({ grant_type: "authorization_code", code: redirect.searchParams.get("code"), redirect_uri: config.callback, code_verifier: verifier });
  stages.push("real_login_pkce_and_selected_note_consent");
  const listed = await rpc(token.access_token, "tools/list"); assert.equal(listed.tools.length, 5); assert.ok(listed.tools.every((tool) => tool.annotations.readOnlyHint === true));
  for (const name of ["get_connection_context", "list_shopping_items", "list_chores", "list_selected_notes", "get_selected_note"]) {
    const result = await rpc(token.access_token, "tools/call", { name, arguments: name === "get_selected_note" ? { noteId: config.noteId } : {} });
    if (name === "get_connection_context") assert.match(result.structuredContent.household, /ALPHA/);
    else assert.equal(result.structuredContent.contentTrust, "untrusted");
  }
  stages.push("five_approved_tools_through_actual_next_gateway");
  const refreshed = await tokens({ grant_type: "refresh_token", refresh_token: token.refresh_token }); assert.ok(refreshed.refresh_token !== token.refresh_token, "Refresh token did not rotate");
  await rpc(refreshed.access_token, "tools/call", { name: "get_connection_context", arguments: {} }); stages.push("refresh_rotation");
  await json("/api/mcp-auth/connections/" + connectionId + "/revoke", {});
  const denied = await request("/api/mcp", {}, { authorization: "Bearer " + refreshed.access_token }); assert.equal(denied.status, 401); connectionId = undefined; stages.push("disconnect_invalidates_access");
  const repository = { branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), modified: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) };
  await writeFile(join(directory, "mcp-smoke.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), project, origin, repository, stages, result: "passed", transport: "loopback_http_nonproduction", client: "synthetic_protocol_driver", liveChatGPTVerified: false }, null, 2));
  await writeFile(join(directory, "mcp-public-client.json"), JSON.stringify({ origin, clientId: config.clientId }, null, 2));
  console.log(JSON.stringify({ result: "passed", stages, liveChatGPTVerified: false }));
} finally {
  if (connectionId) { const response = await request("/api/mcp-auth/connections/" + connectionId + "/revoke", {}); assert.ok(response.ok, "Synthetic connection cleanup failed"); }
}
