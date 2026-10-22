import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { POST } from "./route";

const publicOrigin = "https://household.example.test";
let handler: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => handler(request, response));
let prior: string | undefined;
beforeEach(async () => {
  prior = process.env.API_URL;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
  process.env.API_URL = "http://127.0.0.1:" + address.port;
});
afterEach(async () => {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  if (prior === undefined) delete process.env.API_URL; else process.env.API_URL = prior;
});
function input(body = "{}") {
  return new Request(publicOrigin + "/api/mcp", { method: "POST", headers: { host: "household.example.test", origin: publicOrigin, authorization: "Bearer synthetic-token", cookie: "private-browser-cookie", "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": "get_connection_context", "mcp-protocol-version": "2026-07-28", "x-forwarded-host": "attacker.invalid" }, body });
}
it("preserves the canonical public Host over a real connection to a different upstream and strips cookies", async () => {
  let observed: IncomingMessage["headers"] = {};
  handler = (request, response) => { observed = request.headers; response.writeHead(200, { "content-type": "application/json", "set-cookie": "upstream-private-cookie", "mcp-protocol-version": "2026-07-28" }); response.end('{"ok":true}'); };
  const response = await POST(input());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
  expect(observed).toMatchObject({ host: "household.example.test", origin: publicOrigin, authorization: "Bearer synthetic-token", "mcp-method": "tools/call", "mcp-name": "get_connection_context", "mcp-protocol-version": "2026-07-28" });
  expect(observed.cookie).toBeUndefined(); expect(observed["x-forwarded-host"]).toBeUndefined(); expect(response.headers.has("set-cookie")).toBe(false);
});
it("preserves the bearer challenge and does not follow upstream redirects", async () => {
  handler = (_request, response) => { response.writeHead(401, { "www-authenticate": 'Bearer resource_metadata="https://household.example.test/.well-known/oauth-protected-resource/api/mcp"' }); response.end("denied"); };
  const response = await POST(input()); expect(response.status).toBe(401); expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  handler = (_request, response) => { response.writeHead(302, { location: "https://outside.invalid" }); response.end(); };
  const redirected = await POST(input()); expect(redirected.status).toBe(302); expect(redirected.headers.has("location")).toBe(false);
});
it("bounds request and response bytes with real upstream IO", async () => {
  let calls = 0;
  handler = (_request, response) => { calls++; response.end("X".repeat(32769)); };
  expect((await POST(input("X".repeat(65537)))).status).toBe(413); expect(calls).toBe(0);
  expect((await POST(input())).status).toBe(413); expect(calls).toBe(1);
});
it("handles an empty upstream response", async () => {
  handler = (_request, response) => { response.writeHead(204); response.end(); };
  const response = await POST(input()); expect(response.status).toBe(204); expect(await response.text()).toBe("");
});
