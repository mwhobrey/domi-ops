// Public ingress is an explicit, synthetic-only harness option. It never changes
// deployment configuration or the canonical identity of an existing fixture lab.
export function mcpOrigin(value, port) {
  const url = new URL(value);
  const local = url.protocol === "http:" && url.hostname === "localhost" && url.port === String(port);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      (!local && (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Canonical public HTTPS origin or this lab's exact localhost HTTP origin required");
  }
  return { origin: url.origin, remote: !local };
}

export function configureMcpOrigin({ origin, port, command, requested, fresh = false }) {
  const local = `http://localhost:${port}`;
  const result = mcpOrigin(command === "mcp" ? requested ?? origin ?? local : origin ?? local, port);
  if (command === "mcp" && !fresh && result.origin !== (origin ?? local)) throw new Error("Existing QA canonical origin cannot change. Use a separate fresh lab for public MCP testing.");
  if (result.remote && ["up", "run", "providers", "test"].includes(command)) throw new Error("Public MCP lab is synthetic-only; use mcp to restart or reset before changing modes");
  return result;
}

export function assertSyntheticMcpOrigin(env, runtime = process.env) {
  if (!env.MCP_ENABLED || !env.MCP_SYNTHETIC_DEPLOYMENT || env.NODE_ENV !== "test" ||
      runtime.QA_TOKEN?.length !== 64 || !env.DATABASE_URL.includes("@postgres:5432/domi_ops")) throw new Error("Owned synthetic MCP lab required");
  const result = mcpOrigin(env.PUBLIC_APP_URL, runtime.QA_WEB_PORT);
  if (result.remote && runtime.QA_MCP_PUBLIC_ORIGIN !== result.origin) throw new Error("Public MCP QA requires explicit canonical-origin opt-in");
  return result;
}
