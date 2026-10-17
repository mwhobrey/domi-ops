import { describe, expect, it } from "vitest";
import { downloadPublicHttpsFile, isPublicDownloadAddress } from "./safe-public-download.js";
describe("external snapshot network boundary", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::1"])("rejects nonpublic address %s", (address) => {
    expect(isPublicDownloadAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicDownloadAddress(address)).toBe(true);
  });
  it("rejects credential URLs and unsafe schemes/ports before a request", async () => {
    for (const url of ["http://example.test/file", "file:///etc/passwd", "https://name:password@example.test/file", "https://example.test:8443/file", "https://127.0.0.1/file", "https://[::1]/file"]) {
      expect(await downloadPublicHttpsFile(url, 1024)).toBeNull();
    }
  });
});
