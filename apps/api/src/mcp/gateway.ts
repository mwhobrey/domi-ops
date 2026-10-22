import { Hono } from "hono";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { MCP_SCOPES, McpAuthorizationError, mcpUrls, type createMcpAuthorization } from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import type { Env } from "@domi-ops/config";
import { admit, finish, tagTool } from "./activity.js";
import { checkOperation, MCP_LIMITS, McpGatewayError } from "./access.js";
import { approvedToolNames, contextTool, type McpTool } from "./tools.js";
import { readMcpBody } from "./bounds.js";

type Authorization = ReturnType<ReturnType<typeof createMcpAuthorization>["attach"]>;

/** Stateless transport. Only code-reviewed tools may be registered here. */
export function mcpGateway(db: Database, auth: Authorization, env: Env, tools: readonly McpTool[] = [contextTool]) {
  const app = new Hono();
  const urls = mcpUrls(env), canonical = new URL(urls.origin);
  const resourceScopes = MCP_SCOPES.filter((scope) => scope !== "offline_access");
  const challenge = `Bearer resource_metadata="${urls.origin}/.well-known/oauth-protected-resource/api/mcp"`;
  const failure = (code: string, status: number, headers?: Record<string, string>) => Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store", ...headers } });
  if (tools.some((tool) => !approvedToolNames.includes(tool.name) || tool.access !== "read") || new Set(tools.map((t) => t.name)).size !== tools.length) throw new Error("Invalid MCP tool registry");
  for (const path of ["/api/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) app.use(path, async (_c, next) => {
    if (!env.MCP_ENABLED || env.DEMO_MODE) return failure("not_found", 404);
    await next();
  });

  app.get("/.well-known/oauth-protected-resource", (c) => c.json({ resource: urls.resource, authorization_servers: [urls.issuer], bearer_methods_supported: ["header"], scopes_supported: resourceScopes }, 200, { "Cache-Control": "no-store" }));
  app.get("/.well-known/oauth-protected-resource/api/mcp", (c) => c.json({ resource: urls.resource, authorization_servers: [urls.issuer], bearer_methods_supported: ["header"], scopes_supported: resourceScopes }, 200, { "Cache-Control": "no-store" }));
  app.all("/api/mcp", async (c) => {
    if (!env.MCP_ENABLED || env.DEMO_MODE) return failure("not_found", 404);
    if (c.req.header("host") !== canonical.host || (c.req.header("origin") !== undefined && c.req.header("origin") !== urls.origin)) return failure("invalid_origin", 403);
    if (c.req.method !== "POST") return failure("method_not_allowed", 405, { Allow: "POST" });
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, c.req.raw.signal]);
    const bearerRequest = new Request(urls.resource, { headers: { authorization: c.req.header("authorization") ?? "" }, signal });
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<Response>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(failure("deadline_exceeded", 504)); }, MCP_LIMITS.deadlineMs); });
    const execute = async () => {
      let admission: Awaited<ReturnType<typeof admit>> | undefined;
      let identity: Awaited<ReturnType<Authorization["authorize"]>> | undefined;
      let outcome = "failed", bytes = 0;
      let handler: ReturnType<typeof createMcpHandler> | undefined;
      try {
        identity = await auth.authorize(bearerRequest);
        signal.throwIfAborted();
        // Admit before parsing untrusted arguments. Audit tags never contain caller text.
        admission = await admit(db, identity, "protocol");
        if (!admission.allowed) return failure("rate_limited", 429, { "Retry-After": String(admission.retryAfter) });
        signal.throwIfAborted();
        const sdk = createMcpHonoApp({ allowedHosts: [canonical.hostname], allowedOrigins: [canonical.hostname], maxRequestBodySize: MCP_LIMITS.requestBytes });
        sdk.onError(() => failure("invalid_request", 400));
        sdk.post("/api/mcp", async (request) => {
          signal.throwIfAborted();
          const parsedBody = (request.get as (key: string) => unknown)("parsedBody");
          const method = parsedBody && typeof parsedBody === "object" && "method" in parsedBody ? parsedBody.method : undefined;
          if (typeof method === "string" && !["server/discover", "tools/list", "tools/call", "initialize", "ping"].includes(method)) return failure("method_not_allowed", 400);
          handler = createMcpHandler(() => {
            const server = new McpServer({ name: "domi-ops", version: "1.0.0" }, { capabilities: { tools: { listChanged: false } } });
            server.server.onerror = () => {}; // Never forward protocol errors/arguments to telemetry.
            for (const tool of tools.filter((tool) => tool.scopes.every((scope) => identity!.scopes.includes(scope)))) {
              server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input, outputSchema: tool.output, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (args) => {
                outcome = "tool_denied";
                await tagTool(db, identity!, admission!.id, tool.name);
                try {
                  const result = await auth.withGrantContext(bearerRequest, tool.scopes, async (tx, current) => {
                    await checkOperation(tx, env, current, tool);
                    return tool.output.parse(await tool.run(tx, current, tool.input.parse(args), signal));
                  });
                  signal.throwIfAborted();
                  const text = JSON.stringify(result);
                  if (Buffer.byteLength(text) * 2 > MCP_LIMITS.resultBytes - 1024) throw new McpGatewayError("result_too_large", 413);
                  outcome = "succeeded";
                  return { structuredContent: result, content: [{ type: "text" as const, text }] };
                } catch {
                  if (signal.aborted) outcome = "deadline_exceeded";
                  return { isError: true, content: [{ type: "text" as const, text: "Tool unavailable or request exceeded its bounds." }] };
                }
              });
            }
            return server;
          }, { legacy: "reject", responseMode: "auto", maxRequestBodySize: MCP_LIMITS.requestBytes, onerror: () => {} });
          const response = await handler.fetch(request.req.raw, { parsedBody });
          const body = await response.text();
          bytes = Buffer.byteLength(body);
          signal.throwIfAborted();
          if (bytes > MCP_LIMITS.resultBytes) { outcome = "result_too_large"; return failure("result_too_large", 413); }
          if (outcome === "failed") outcome = response.ok ? "protocol_completed" : "invalid_request";
          return new Response(body || null, { status: response.status, headers: response.headers });
        });
        const body = await readMcpBody(c.req.raw.body, MCP_LIMITS.requestBytes, signal);
        const result = await sdk.fetch(new Request(c.req.url, { method: "POST", headers: c.req.raw.headers, body, signal }), c.env);
        result.headers.set("Cache-Control", "no-store");
        return result;
      } catch (error) {
        if (signal.aborted) { outcome = "deadline_exceeded"; return failure("deadline_exceeded", 504); }
        if (error instanceof RangeError) { outcome = "invalid_request"; return failure("request_too_large", 413); }
        if (error instanceof McpAuthorizationError) return failure(error.code, error.status, { "WWW-Authenticate": challenge });
        return failure("temporarily_unavailable", 503);
      } finally {
        try {
          if (handler) await handler.close();
        } finally {
          if (admission?.allowed && identity) await finish(db, identity, admission.id, signal.aborted ? "deadline_exceeded" : outcome, performance.now() - started, bytes);
        }
      }
    };
    // On timeout the short database work settles and releases its own lease. Never
    // release concurrency while an admitted operation is still running.
    const work = execute().catch(() => failure("temporarily_unavailable", 503));
    try { return await Promise.race([work, expired]); } finally { clearTimeout(timer!); }
  });
  return app;
}
