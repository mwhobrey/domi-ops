import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpOrigin, configureMcpOrigin, assertSyntheticMcpOrigin } from "./mcp-origin.mjs";

test("remote ingress cannot be enabled by a public URL without owned synthetic test guards", () => {
  const env = { MCP_ENABLED: true, MCP_SYNTHETIC_DEPLOYMENT: true, NODE_ENV: "test", DATABASE_URL: "postgresql://fixture@postgres:5432/domi_ops", PUBLIC_APP_URL: "https://synthetic.example.test" };
  const runtime = { QA_TOKEN: "a".repeat(64), QA_WEB_PORT: "18180", QA_MCP_PUBLIC_ORIGIN: env.PUBLIC_APP_URL };
  assert.equal(assertSyntheticMcpOrigin(env, runtime).remote, true);
  for (const mutation of [{ MCP_ENABLED: false }, { MCP_SYNTHETIC_DEPLOYMENT: false }, { NODE_ENV: "production" }, { DATABASE_URL: "postgresql://fixture@production:5432/domi_ops" }]) assert.throws(() => assertSyntheticMcpOrigin({ ...env, ...mutation }, runtime));
  for (const mutation of [{ QA_TOKEN: "" }, { QA_MCP_PUBLIC_ORIGIN: "" }, { QA_MCP_PUBLIC_ORIGIN: "https://other.example.test" }]) assert.throws(() => assertSyntheticMcpOrigin(env, { ...runtime, ...mutation }));
  assert.equal(assertSyntheticMcpOrigin({ ...env, PUBLIC_APP_URL: "http://localhost:18180" }, { ...runtime, QA_MCP_PUBLIC_ORIGIN: "" }).remote, false);
});

test("rejects credential-bearing, noncanonical and incorrect local QA origins", () => {
  for (const value of ["https://user:secret@example.test", "https://example.test/path", "https://example.test/?key=secret", "https://example.test/#x", "http://external.example.test", "http://localhost:17180", "https://localhost", "file:///private"]) assert.throws(() => mcpOrigin(value, 18180));
  assert.deepEqual(mcpOrigin("https://synthetic.example.test/", 18180), { origin: "https://synthetic.example.test", remote: true });
});

test("public lab identity is immutable and cannot switch to provider or ordinary browser modes", () => {
  const options = { origin: "https://synthetic.example.test", port: 18180, command: "mcp" };
  assert.equal(configureMcpOrigin(options).origin, options.origin);
  for (const command of ["up", "run", "providers", "test"]) assert.throws(() => configureMcpOrigin({ ...options, command }), /synthetic-only/);
  for (const requested of ["https://other.example.test", "http://localhost:18180"]) assert.throws(() => configureMcpOrigin({ ...options, requested }), /canonical origin cannot change/);
  assert.throws(() => configureMcpOrigin({ port: 18180, command: "mcp", requested: options.origin }), /canonical origin cannot change/);
  assert.equal(configureMcpOrigin({ port: 18180, command: "mcp", requested: options.origin, fresh: true }).remote, true);
  assert.equal(configureMcpOrigin({ port: 17180, command: "mcp" }).remote, false);
  for (const command of ["status", "logs", "down", "reset"]) assert.doesNotThrow(() => configureMcpOrigin({ ...options, command }));
});
