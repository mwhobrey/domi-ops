/** Uploaded MIME types are untrusted. Never execute active documents on the app origin. */
export function fileResponseHeaders(contentType: string, filename: string, maxAge = 0) {
  const type = contentType.split(";", 1)[0]!.trim().toLowerCase();
  const inline = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf"].includes(type);
  const safeName = filename.replace(/[\x00-\x1f\x7f"\\]/g, "_");
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(safeName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    "Content-Type": type || "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
    "Cache-Control": maxAge > 0 ? `private, max-age=${maxAge}` : "private, no-store",
  };
}
