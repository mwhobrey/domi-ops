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

test("rejects non-public IP literals including URL-normalized IPv4-mapped IPv6", () => {
  for (const host of ["0.0.0.0", "10.0.0.1", "127.0.0.2", "127.1", "2130706433", "0x7f000001",
    "100.64.0.1", "100.127.255.254", "169.254.1.1", "172.16.0.1", "172.31.255.254", "192.168.1.1", "224.0.0.1",
    "[::]", "[::1]", "[::127.0.0.1]", "[fc00::1]", "[fdff::1]", "[fe80::1]", "[febf::1]", "[fec0::1]", "[ff02::1]",
    "[::ffff:10.0.0.1]", "[0:0:0:0:0:ffff:a00:1]", "[::ffff:127.0.0.2]", "[::ffff:169.254.1.1]",
    "[::ffff:172.31.255.254]", "[::ffff:192.168.1.1]", "[::ffff:100.64.0.1]"]) {
    assert.throws(() => mcpOrigin(`https://${host}`, 18180), undefined, host);
  }
  for (const host of ["8.8.8.8", "100.63.255.254", "100.128.0.1", "172.15.255.254", "172.32.0.1",
    "[2606:4700:4700::1111]", "[::ffff:8.8.8.8]"]) {
    assert.equal(mcpOrigin(`https://${host}`, 18180).remote, true, host);
  }
  assert.deepEqual(mcpOrigin("http://localhost:18180", 18180), { origin: "http://localhost:18180", remote: false });
});
