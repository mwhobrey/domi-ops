import { describe, expect, it } from "vitest";
import { readBoundedUpload } from "./browser-uploads.js";

describe("bounded upload reading", () => {
  it("rejects a declared oversized body before consuming it", async () => {
    const request = new Request("http://localhost", { method: "PUT", body: "12345", headers: { "content-length": "5" } });
    await expect(readBoundedUpload(request, 4)).rejects.toThrow("file_too_large");
    expect(request.bodyUsed).toBe(false);
  });
  it("rejects chunked bodies when their actual size crosses the limit", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(3)); },
      cancel() { canceled = true; },
    });
    const request = new Request("http://localhost", { method: "PUT", body: stream, duplex: "half" } as RequestInit);
    await expect(readBoundedUpload(request, 4)).rejects.toThrow("file_too_large");
    expect(canceled).toBe(true);
  });
  it("accepts exactly the allowed bytes", async () => {
    const request = new Request("http://localhost", { method: "PUT", body: "1234" });
    expect((await readBoundedUpload(request, 4)).toString()).toBe("1234");
  });
});
