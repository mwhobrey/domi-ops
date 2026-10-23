// Public ingress is an explicit, synthetic-only harness option. It never changes
// deployment configuration or the canonical identity of an existing fixture lab.
import { isIP } from "node:net";

function nonPublicIpv4(octets) {
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

// Consume URL-normalized hostnames so alternate IPv4 spellings and IPv6 zero
// compression cannot conceal private addresses. This does not verify DNS/routing.
export function nonPublicMcpHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "localhost.") return true;
  if (isIP(host) === 4) return nonPublicIpv4(host.split(".").map(Number));
  if (isIP(host) !== 6) return false;
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/i.exec(host);
  if (mapped) {
    const upper = parseInt(mapped[1], 16), lower = parseInt(mapped[2], 16);
    return nonPublicIpv4([upper >> 8, upper & 255, lower >> 8, lower & 255]);
  }
  const first = parseInt(host.split(":")[0] || "0", 16);
  return first === 0 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00;
}

export function mcpOrigin(value, port) {
  const url = new URL(value);
  const local = url.protocol === "http:" && url.hostname === "localhost" && url.port === String(port);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      (!local && (url.protocol !== "https:" || nonPublicMcpHost(url.hostname)))) {
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
