import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function isPublicDownloadAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const [a, b] = address.toLowerCase().split(":").map((part) => parseInt(part || "0", 16));
    // Global unicast only; exclude special-purpose, documentation and transition ranges.
    return a! >= 0x2000 && a! < 0x3fff && a !== 0x2002 &&
      !(a === 0x2001 && (b! <= 0x1ff || b === 0xdb8));
  }
  return false;
}

/** Server-side external snapshots: validate every redirect and pin the validated DNS
 * address for the TLS connection, preventing private-network access and DNS rebinding. */
export async function downloadPublicHttpsFile(input: string, maxBytes: number, redirects = 0): Promise<{ body: Buffer; contentType: string } | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || redirects > 3) return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch { return null; }
  if (!addresses.length || addresses.some(({ address }) => !isPublicDownloadAddress(address))) return null;
  const pinned = addresses[0]!;
  const result = await new Promise<{ body: Buffer; contentType: string } | { redirect: string } | null>((resolve) => {
    const req = request(url, {
      method: "GET", agent: false, headers: { "Accept-Encoding": "identity" },
      lookup: (_host, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try { resolve({ redirect: new URL(res.headers.location, url).toString() }); }
        catch { resolve(null); }
        res.destroy(); return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || Number(res.headers["content-length"] ?? 0) > maxBytes) {
        res.destroy(); resolve(null); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); resolve(null); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ body: Buffer.concat(chunks, size), contentType: res.headers["content-type"]?.split(";", 1)[0]?.trim() || "application/octet-stream" }));
      res.on("error", () => resolve(null));
    });
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, 5000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => resolve(null));
    req.end();
  });
  if (result && "redirect" in result) return downloadPublicHttpsFile(result.redirect, maxBytes, redirects + 1);
  return result;
}
