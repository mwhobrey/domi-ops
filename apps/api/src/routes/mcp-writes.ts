import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { McpAuthorizationError, type McpAuthorization } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import { McpGatewayError } from "../mcp/access.js";
import { reviewedWrites, ReviewedWriteError, prepareWriteInput, writeReference, writeConfirmation, type ReviewedOperation } from "../mcp/reviewed-writes.js";

export function mcpWriteRoutes(auth: McpAuthorization, env: Env, operations: readonly ReviewedOperation[] = []) {
  const app = new Hono(), service = reviewedWrites(auth, env, operations);
  app.use("*", bodyLimit({ maxSize: 16384, onError: c => c.json({ error: "request_too_large" },413) }));
  app.use("*", async(c,next)=>{
    c.header("Cache-Control","no-store");
    if (!env.MCP_ENABLED || !env.MCP_WRITES_ENABLED || env.DEMO_MODE) return c.json({error:"writes_not_enabled"},404);
    if(c.req.method!=="POST")return c.json({error:"method_not_allowed"},405);
    if(c.req.path.includes("/browser/") && (c.req.header("origin")!==auth.urls.origin || c.req.header("sec-fetch-site")==="cross-site"))return c.json({error:"invalid_origin"},403);
    await next();
  });
  app.onError((error,c)=>{
    if(error instanceof McpAuthorizationError || error instanceof McpGatewayError || error instanceof ReviewedWriteError)return c.json({error:error.code},error.status);
    if(error instanceof z.ZodError)return c.json({error:"invalid_request"},400);
    // A lost commit response is not evidence of rollback. Never replay here.
    return c.json({error:"write_outcome_unknown",nextStep:"Check this same change's status before trying anything else."},503);
  });
  async function body<T>(request:Request,schema:z.ZodType<T>):Promise<T>{
    let data:unknown;try{data=await request.json();}catch{throw new ReviewedWriteError("invalid_request",400);}
    return schema.parse(data);
  }
  app.post("/prepare",async c=>c.json(await service.prepare(c.req.raw,await body(c.req.raw,prepareWriteInput))));
  app.post("/status",async c=>c.json(await service.status(c.req.raw,(await body(c.req.raw,writeReference)).intentId)));
  app.post("/browser/:connectionId/review",async c=>c.json(await service.review(c.req.raw.headers,c.req.param("connectionId"),(await body(c.req.raw,writeReference)).intentId)));
  app.post("/browser/:connectionId/confirm",async c=>c.json(await service.confirm(c.req.raw.headers,c.req.param("connectionId"),await body(c.req.raw,writeConfirmation))));
  app.post("/browser/:connectionId/reject",async c=>c.json(await service.reject(c.req.raw.headers,c.req.param("connectionId"),(await body(c.req.raw,writeReference)).intentId)));
  return app;
}
