import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt, username } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { z } from "zod";

declare module "hono" {
  interface ContextVariableMap { parsedBody: unknown }
}

const auth = betterAuth({
  disabledPaths: ["/token"],
  database: memoryAdapter({}),
  plugins: [username(), jwt(), oauthProvider({
    loginPage: "/login", consentPage: "/ai/consent",
    scopes: ["shopping:read", "chores:read", "notes:read", "offline_access"],
    resources: [{identifier: "https://synthetic.example.test/api/mcp", allowedScopes: ["shopping:read", "offline_access"]}],
    grantTypes: ["authorization_code", "refresh_token"],
  })],
});
const verify = oauthProviderResourceClient(auth).getActions().verifyAccessTokenRequest;
const app = createMcpHonoApp();
app.all("/api/mcp", async c => {
  await verify(c.req.raw, {verifyOptions: {issuer: "https://synthetic.example.test/auth", audience: "https://synthetic.example.test/api/mcp"}, requiredScopes: ["shopping:read"]});
  const server = new McpServer({name: "synthetic", version: "1"});
  server.registerTool("synthetic_read", {inputSchema: z.object({}), annotations: {readOnlyHint: true}}, async () => ({content: [{type: "text", text: "fixture"}]}));
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
  await server.connect(transport);
  return transport.handleRequest(c.req.raw, {parsedBody: c.get("parsedBody")});
});
