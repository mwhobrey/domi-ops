import { describe, expect, it } from "vitest";
import { fileResponseHeaders } from "./file-response.js";

describe("untrusted file responses", () => {
  it.each(["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript"])("downloads active content %s", (type) => {
    const headers = fileResponseHeaders(type, 'file"\r\n.html');
    expect(headers["Content-Disposition"]).toContain('attachment; filename="file___.html";');
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
    expect(headers["Cache-Control"]).toContain("no-store");
  });
  it("keeps non-Latin names usable without invalid HTTP header characters", () => {
    const headers = fileResponseHeaders("text/plain", "数学.txt");
    expect(headers["Content-Disposition"]).toContain("filename*=UTF-8''%E6%95%B0%E5%AD%A6.txt");
    expect(() => new Headers(headers)).not.toThrow();
  });
  it.each(["image/png", "image/jpeg", "application/pdf"])("preserves safe previews for %s", (type) => {
    expect(fileResponseHeaders(type, "file")["Content-Disposition"]).toContain("inline;");
  });
});
