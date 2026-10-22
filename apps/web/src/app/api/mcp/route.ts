/** Fixed upstream, bearer-only bridge for installations using Next as their proxy. */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

export const runtime = "nodejs";

function upstream(url: URL, headers: Headers, body: Uint8Array, signal: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; status: number; headers: Headers }> {
  // Node fetch replaces Host with the internal API hostname. The native request
  // preserves the public Host needed by the gateway's canonical-origin check.
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, { method: "POST", headers: Object.fromEntries(headers), signal }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const entry of value) responseHeaders.append(name, entry);
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      resolve({ body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, status: incoming.statusCode ?? 502, headers: responseHeaders });
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function boundedBody(stream: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal) {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = stream?.getReader();
  if (!reader) return new Uint8Array();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new RangeError("body_limit"); }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

export async function POST(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
  try {
    const headers = new Headers();
    for (const name of ["authorization", "host", "origin", "accept", "content-type", "mcp-protocol-version", "mcp-method", "mcp-name"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const body = await boundedBody(request.body, 65536, signal);
    const response = await upstream(new URL("/api/mcp", process.env.API_URL ?? "http://localhost:4000"), headers, body, signal);
    const result = await boundedBody(response.body, 32768, signal);
    const outgoing = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "www-authenticate", "allow", "retry-after", "mcp-protocol-version"]) {
      const value = response.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    return new Response(result.length ? result : null, { status: response.status, headers: outgoing });
  } catch (error) {
    return Response.json({ error: error instanceof RangeError ? "body_limit" : "temporarily_unavailable" }, { status: error instanceof RangeError ? 413 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
const unsupported = () => Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
export { unsupported as GET, unsupported as DELETE, unsupported as PUT, unsupported as PATCH, unsupported as OPTIONS, unsupported as HEAD };
