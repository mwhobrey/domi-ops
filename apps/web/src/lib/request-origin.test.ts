import { describe, expect, it } from "vitest";
import { originFromHeaders } from "./request-origin";

const from = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

describe("originFromHeaders", () => {
  it("uses the forwarded host and protocol a proxy sets", () => {
    expect(originFromHeaders(from({ "x-forwarded-host": "app.domi-ops.com", "x-forwarded-proto": "https", host: "web:3000" }))).toBe(
      "https://app.domi-ops.com",
    );
  });

  it("falls back to the Host header, and to https unless it is a local address", () => {
    expect(originFromHeaders(from({ host: "family.example.org" }))).toBe("https://family.example.org");
    expect(originFromHeaders(from({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(originFromHeaders(from({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
    expect(originFromHeaders(from({ host: "[::1]:3000" }))).toBe("http://[::1]:3000");
  });

  it("takes the first entry of a comma-separated forwarded chain", () => {
    expect(
      originFromHeaders(from({ "x-forwarded-host": "app.domi-ops.com, internal:3000", "x-forwarded-proto": "https, http" })),
    ).toBe("https://app.domi-ops.com");
  });

  it("honours an explicit http protocol and ignores any other value", () => {
    expect(originFromHeaders(from({ host: "lan.example", "x-forwarded-proto": "http" }))).toBe("http://lan.example");
    expect(originFromHeaders(from({ host: "lan.example", "x-forwarded-proto": "javascript" }))).toBe("https://lan.example");
  });

  it("skips a malformed forwarded host and uses the Host header instead", () => {
    expect(originFromHeaders(from({ "x-forwarded-host": "evil.com/x", host: "app.domi-ops.com" }))).toBe("https://app.domi-ops.com");
  });

  it("returns null when there is no usable host, rather than guessing", () => {
    expect(originFromHeaders(from({}))).toBeNull();
    expect(originFromHeaders(from({ host: "" }))).toBeNull();
    for (const bad of ["evil.com/path", "a b.com", "x.com\r\nSet-Cookie: a=b", "<script>", "http://x.com", "x.com:99999999"]) {
      expect(originFromHeaders(from({ host: bad })), bad).toBeNull();
    }
  });
});
