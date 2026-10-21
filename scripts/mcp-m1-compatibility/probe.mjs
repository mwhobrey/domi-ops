import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt, username } from "better-auth/plugins";
import { oauthProvider, oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { z } from "zod";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const evidence = { baseline: "02cee513b42757f23a7feb3807769b3505b00ec4", node: process.version, checks: [], limits: ["Isolated synthetic memory adapter; not application integration or live client acceptance."] };
function passed(name) { evidence.checks.push(name); console.log("PASS " + name); }
async function redirectOf(response) {
  const location = response.headers.get("location");
  if (location) return location;
  const body = await response.json();
  assert.ok(body.redirect_uri || body.url, "Expected authorization redirect: " + JSON.stringify(body));
  return body.redirect_uri || body.url;
}
const app = new Hono();
let auth;
let sdkHandler;
app.all("/auth/*", c => auth.handler(c.req.raw));
app.all("/api/mcp", c => sdkHandler(c.req.raw));
app.get("/.well-known/oauth-authorization-server/auth", c => oauthProviderAuthServerMetadata(auth)(c.req.raw));
const http = serve({fetch: app.fetch, hostname: "127.0.0.1", port: 0});
await new Promise(resolve => http.listening ? resolve() : http.once("listening", resolve));
const origin = "http://127.0.0.1:" + http.address().port;
const resource = origin + "/api/mcp";
const fixtureGrantId = randomUUID();
const database = {users: [], ba_sessions: [], ba_accounts: [], ba_verifications: [], jwks: []};
const provider = oauthProvider({
  loginPage: "/login", consentPage: "/consent",
  scopes: ["shopping:read", "chores:read", "notes:read", "offline_access"],
  resources: [{identifier: resource, allowedScopes: ["shopping:read", "chores:read", "notes:read", "offline_access"], accessTokenTtl: 300}],
  clientRegistrationDefaultResources: [resource],
  allowDynamicClientRegistration: false,
  storeTokens: "hashed",
  grantTypes: ["authorization_code", "refresh_token"],
  postLogin: {page: "/ai/consent", shouldRedirect: () => false, consentReferenceId: () => fixtureGrantId},
  customAccessTokenClaims: ({referenceId}) => ({domi_grant_id: referenceId}),
});
for (const model of Object.keys(provider.schema)) database[model] = [];
let pg;
const options = {
  disabledPaths: ["/token"],
  appName: "Domi Ops synthetic M1 probe",
  baseURL: origin, basePath: "/auth",
  secret: "synthetic-only-" + randomUUID() + randomUUID(),
  database: memoryAdapter(database),
  emailAndPassword: {enabled: true},
  user: {modelName: "users", fields: {name: "displayName", image: "imageUrl"}},
  session: {modelName: "ba_sessions"},
  account: {modelName: "ba_accounts"},
  verification: {modelName: "ba_verifications"},
  advanced: {database: {generateId: () => randomUUID()}},
  rateLimit: {enabled: false},
  telemetry: {enabled: false},
  plugins: [username(), jwt(), provider],
};
if(process.env.MCP_M1_PG === "1") {
  const {createPostgresFixture}=await import("./postgres-fixture.mjs");
  pg=await createPostgresFixture(options);
  options.database=pg.adapter;
  evidence.limits=["Synthetic PostgreSQL tables generated from provider schema; not production migrations, app domain routes or live-client acceptance."];
  evidence.postgresSchema=pg.schema;
}
auth = betterAuth(options);
try {
  await auth.$context;
  passed("Better Auth 1.7.10 + OAuth provider 1.7.10 + existing username/JWT composition initializes");
  evidence.providerSchema = Object.fromEntries(Object.entries(provider.schema).map(([model, config]) => [model, Object.fromEntries(Object.entries(config.fields).map(([name, field]) => [name, {type: field.type, required: field.required, references: field.references}]))]));
  console.log("MODELS " + Object.keys(evidence.providerSchema).join(","));
  const signup = await auth.handler(new Request(origin + "/auth/sign-up/email", {method:"POST", headers:{"content-type":"application/json", origin}, body: JSON.stringify({name:"Synthetic Adult", email:"m1-adult@example.test", password:"synthetic-fixture-password-2026"})}));
  if(signup.status !== 200) throw new Error("Synthetic sign-up status " + signup.status + ": " + await signup.text());
  const signupBody=await signup.json();
  const cookies=signup.headers.getSetCookie().map(x=>x.split(";")[0]).join("; ");
  assert.ok(cookies);
  const headers = new Headers({cookie:cookies, origin});
  const session=await auth.api.getSession({headers});
  assert.equal(session.user.id, signupBody.user.id);
  passed("Existing custom auth model names support synthetic signup and browser session");
  const client=await auth.api.createOAuthClient({headers,body:{client_name:"M1 synthetic client",application_type:"native",redirect_uris:[origin+"/callback"],token_endpoint_auth_method:"client_secret_post",grant_types:["authorization_code","refresh_token"],scope:"shopping:read chores:read offline_access"}});
  evidence.clientFields=Object.keys(client);
  const metadataResponse=await fetch(origin+"/.well-known/oauth-authorization-server/auth");
  assert.equal(metadataResponse.status,200);
  const metadata=await metadataResponse.json();
  assert.equal(metadata.issuer, origin+"/auth");
  assert.deepEqual(metadata.code_challenge_methods_supported,["S256"]);
  assert.ok(!metadata.grant_types_supported.includes("client_credentials"));
  passed("Discovery excludes machine client-credentials grants");
  assert.equal((await fetch(origin+"/auth/token",{headers})).status,404);
  passed("Adding JWT support does not expose the generic browser-session /token endpoint");
  passed("Deployment-local issuer discovery exposes S256 and exact auth endpoint routing");
  const verifier="v".repeat(64), challenge=createHash("sha256").update(verifier).digest("base64url");
  const query=new URLSearchParams({response_type:"code",client_id:client.client_id,redirect_uri:origin+"/callback",scope:"shopping:read offline_access",state:"synthetic-state",code_challenge:challenge,code_challenge_method:"S256",resource});
  const authorize=await fetch(metadata.authorization_endpoint+"?"+query,{headers,redirect:"manual"});
  const location=await redirectOf(authorize);
  let redirect;
  if(location && new URL(location,origin).searchParams.has("code")) redirect=location;
  else {
    assert.ok(location,"Consent redirect required");
    const consentQuery=new URL(location,origin).searchParams.toString();
    const consent=await fetch(origin+"/auth/oauth2/consent",{method:"POST",headers:{cookie:cookies,origin,"content-type":"application/json"},body:JSON.stringify({accept:true,oauth_query:consentQuery}),redirect:"manual"});
    redirect=await redirectOf(consent);
  }
  const code=new URL(redirect).searchParams.get("code");
  assert.ok(code,"Authorization code");
  const tokenRequest=async body=>fetch(metadata.token_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_secret:client.client_secret,...body})});
  const bad=await tokenRequest({grant_type:"authorization_code",client_id:client.client_id,code,redirect_uri:origin+"/callback",code_verifier:"b".repeat(64),resource});
  assert.ok(bad.status>=400);
  passed("Wrong PKCE verifier rejected");
  // The provider may consume a rejected code; request a new one for the valid exchange.
  const again=await fetch(metadata.authorization_endpoint+"?"+query,{headers,redirect:"manual"});
  let redirectAgain=await redirectOf(again);
  if(!redirectAgain || !new URL(redirectAgain,origin).searchParams.has("code")) {
    const c=await fetch(origin+"/auth/oauth2/consent",{method:"POST",headers:{cookie:cookies,origin,"content-type":"application/json"},body:JSON.stringify({accept:true,oauth_query:new URL(redirectAgain,origin).searchParams.toString()}),redirect:"manual"});
    redirectAgain=await redirectOf(c);
  }
  const good=await tokenRequest({grant_type:"authorization_code",client_id:client.client_id,code:new URL(redirectAgain).searchParams.get("code"),redirect_uri:origin+"/callback",code_verifier:verifier,resource});
  if(good.status!==200) throw new Error("Token status "+good.status+": "+await good.text());
  const tokens=await good.json();
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);
  passed("Authorization code with S256 issues resource-bound access and refresh tokens");
  evidence.tokenResponseFields=Object.keys(tokens);
  evidence.authMetadata={issuerPath:new URL(metadata.issuer).pathname,tokenPath:new URL(metadata.token_endpoint).pathname,grantTypes:metadata.grant_types_supported};
  const verify=oauthProviderResourceClient(auth).getActions().verifyAccessTokenRequest;
  const request=()=>new Request(resource,{method:"POST",headers:{authorization:"Bearer "+tokens.access_token}});
  const verifyOptions={issuer:metadata.issuer,audience:resource};
  const payload=await verify(request(),{verifyOptions,requiredScopes:["shopping:read"]});
  assert.equal(payload.sub,signupBody.user.id);
  assert.equal(payload.domi_grant_id,fixtureGrantId);
  await assert.rejects(()=>verify(request(),{verifyOptions:{...verifyOptions,audience:origin+"/wrong-resource"}}));
  await assert.rejects(()=>verify(request(),{verifyOptions:{...verifyOptions,issuer:origin+"/another-installation"}}));
  await assert.rejects(()=>verify(request(),{verifyOptions,requiredScopes:["notes:read"]}));
  await assert.rejects(()=>verify(request(),{verifyOptions:{...verifyOptions,currentDate:new Date(Date.now()+600_000)}}));
  passed("Resource helper verifies JWT and rejects wrong audience, issuer, scope and expiry");
  const sdkApp=createMcpHonoApp();
  sdkApp.all("*",async c=>{
    try { await verify(c.req.raw,{verifyOptions,requiredScopes:["shopping:read"]}); }
    catch { return c.json({error:"unauthorized"},401); }
    const server=new McpServer({name:"synthetic-m1",version:"1.0.0"});
    server.registerTool("synthetic_read",{inputSchema:z.object({}),annotations:{readOnlyHint:true}},async()=>({content:[{type:"text",text:"synthetic fixture only"}]}));
    const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await server.connect(transport);
    const response=await transport.handleRequest(c.req.raw,{parsedBody:c.get("parsedBody")});
    await server.close();
    return response;
  });
  sdkHandler=sdkApp.fetch;
  const sdkClient=new Client({name:"synthetic-m1-client",version:"1.0.0"});
  const sdkTransport=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{authorization:"Bearer "+tokens.access_token}}});
  try {
    await sdkClient.connect(sdkTransport);
    const list=await sdkClient.listTools();
    assert.ok(list.tools.some(t=>t.name==="synthetic_read"));
    const result=await sdkClient.callTool({name:"synthetic_read",arguments:{}});
    assert.equal(result.content[0].text,"synthetic fixture only");
    passed("Official SDK v2 client discovers and calls authenticated stateless Hono tool over HTTP");
  } finally { await sdkClient.close(); }
  assert.equal((await fetch(resource,{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).status,401);
  passed("MCP endpoint denies requests without a bearer token");
  const introspect=async token=>{
    const response=await fetch(metadata.introspection_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token,client_id:client.client_id,client_secret:client.client_secret})});
    const body=await response.json();
    assert.equal(response.status,200,"Introspection status: "+JSON.stringify(body));
    return body;
  };
  assert.equal((await introspect(tokens.refresh_token)).active,true);
  const refresh=await tokenRequest({grant_type:"refresh_token",client_id:client.client_id,refresh_token:tokens.refresh_token,resource,scope:"shopping:read offline_access"});
  assert.equal(refresh.status,200);
  const renewed=await refresh.json();
  assert.ok(renewed.refresh_token,"Refresh response fields: "+JSON.stringify(Object.keys(renewed))+" error="+renewed.error);
  assert.notEqual(renewed.refresh_token,tokens.refresh_token);
  assert.equal((await introspect(tokens.refresh_token)).active,false);
  passed("Refresh rotates tokens and makes the consumed refresh token inactive");
  const revoked=await fetch(metadata.revocation_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token:renewed.refresh_token,client_id:client.client_id,client_secret:client.client_secret,token_type_hint:"refresh_token"})});
  assert.equal(revoked.status,200);
  assert.equal((await introspect(renewed.refresh_token)).active,false);
  passed("Revocation endpoint invalidates the current refresh token");
  const replay=await tokenRequest({grant_type:"refresh_token",client_id:client.client_id,refresh_token:renewed.refresh_token,resource});
  assert.ok(replay.status>=400);
  passed("Revoked refresh token cannot mint another access token");
  const refreshedPayload=await verify(new Request(resource,{headers:{authorization:"Bearer "+renewed.access_token}}),{verifyOptions,requiredScopes:["shopping:read"]});
  assert.equal(refreshedPayload.domi_grant_id,fixtureGrantId);
  passed("Provider consent reference binds immutable application grant claim across refresh");
  passed("Stateless JWT verification still accepts a signature-valid token after refresh revocation; live grant checks are required");
  const publicClient=await auth.api.createOAuthClient({headers,body:{client_name:"M1 public client",application_type:"native",redirect_uris:[origin+"/public-callback"],token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],scope:"shopping:read offline_access"}});
  const publicQuery=new URLSearchParams(query);
  publicQuery.set("client_id",publicClient.client_id);
  publicQuery.set("redirect_uri",origin+"/public-callback");
  const publicAuth=await fetch(metadata.authorization_endpoint+"?"+publicQuery,{headers,redirect:"manual"});
  const publicConsentUrl=await redirectOf(publicAuth);
  const publicConsent=await fetch(origin+"/auth/oauth2/consent",{method:"POST",headers:{cookie:cookies,origin,"content-type":"application/json"},body:JSON.stringify({accept:true,oauth_query:new URL(publicConsentUrl,origin).searchParams.toString()}),redirect:"manual"});
  const publicCode=new URL(await redirectOf(publicConsent)).searchParams.get("code");
  assert.ok(publicCode);
  const publicToken=await fetch(metadata.token_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:publicClient.client_id,code:publicCode,redirect_uri:origin+"/public-callback",code_verifier:verifier,resource})});
  assert.equal(publicToken.status,200);
  const publicTokens=await publicToken.json();
  assert.ok(publicTokens.access_token && publicTokens.refresh_token);
  passed("Public client PKCE flow issues tokens without a client secret");
  if(pg) {
    await pg.verifyTenantPlan();
    passed("PostgreSQL Drizzle adapter completes OAuth lifecycle with UUID IDs and custom auth model names");
    passed("Restricted-role two-household RLS fixture denies missing/wrong context, cross-household update and pooled context leakage");
  }
  evidence.dependencyPinning="Pin @better-auth/core 1.7.10 and better-call 1.4.2 alongside provider/auth 1.7.10 to avoid peer auto-selection of 1.7.12";
  evidence.refreshPolicy="Include offline_access in the resource scope allowlist; it is a lifecycle scope, never a domain permission";
  await writeFile(new URL(pg?"./receipt-postgres.json":"./receipt.json",import.meta.url), JSON.stringify(evidence,null,2)+"\n");
} finally {
  if(pg) await pg.close();
  await new Promise((resolve,reject)=>http.close(error=>error?reject(error):resolve()));
}
