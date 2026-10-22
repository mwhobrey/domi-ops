/** Cancel slow uploads at the same deadline as tool execution. */
export async function readMcpBody(stream: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal) {
  const reader = stream?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { void reader.cancel().catch(() => {}); throw new RangeError("request_too_large"); }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
