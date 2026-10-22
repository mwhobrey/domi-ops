/** Fixed upstream, bearer-only bridge for installations using Next as their proxy. */
export const runtime = "nodejs";

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
    const response = await fetch(new URL("/api/mcp", process.env.API_URL ?? "http://localhost:4000"), { method: "POST", headers, body, signal, redirect: "manual", cache: "no-store" });
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
