import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { planMcpClient, provisionMcpClient, readMcpOperatorFile } from "./mcp-client-provisioning.js";

const origin = "https://pilot.example.test";
const config = { origin, name: "Private adult pilot", provider: "claude", profileVersion: "pilot.claude.v1",
  redirectUri: "https://claude.ai/api/mcp/auth_callback", scopes: ["shopping:read", "chores:read", "offline_access"] };
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "domi-mcp-provision-")); roots.push(root);
  const cookieFile = join(root, "session.private"), receiptFile = join(root, "receipt.json");
  await writeFile(cookieFile, "synthetic_session=private-canary", { mode: 0o600 });
  return { root, cookieFile, receiptFile };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(dirname(root)).toBe(resolve(tmpdir())); expect(basename(root)).toMatch(/^domi-mcp-provision-/);
    await rm(root, { recursive: true, force: true });
  }
});

describe("operator MCP provisioning", () => {
  it("pins public-client household profiles to the exact deployment and defaults disabled", () => {
    const plan = planMcpClient(config, origin);
    expect(plan.registration).toMatchObject({ enabled: false, dataMode: "household", tokenEndpointAuthMethod: "none", redirectUris: [config.redirectUri] });
    expect(planMcpClient({ ...config, scopes: [...config.scopes].reverse() }, origin).sha256).toBe(plan.sha256);
    expect(planMcpClient({ ...config, enabled: true }, origin).sha256).not.toBe(plan.sha256);
    expect(planMcpClient({ ...config, provider: "chatgpt", redirectUri: "https://chatgpt.com/connector/oauth/observed-callback" }, origin).registration.provider).toBe("chatgpt");
    expect(planMcpClient({ ...config, provider: "gemini", redirectUri: "https://oauth-redirect.googleusercontent.com/r/observed_callback" }, origin).registration).toMatchObject({ provider: "gemini", enabled: false });
  });

  it("rejects unreviewed providers, secret-bearing config, widened scopes and callback lookalikes", () => {
    for (const mutation of [{ origin: "https://other.example.test" }, { provider: "other" }, { provider: ["gemini"] }, { clientSecret: "secret-canary" },
      { dataMode: "synthetic" }, { scopes: ["offline_access"] }, { scopes: ["shopping:write"] }, { scopes: ["shopping:read", "shopping:read"] },
      { enabled: "true" }, { redirectUri: "https://claude.ai.example.test/api/mcp/auth_callback" },
      { redirectUri: config.redirectUri + "?secret=canary" }, { redirectUri: "https://user:secret@claude.ai/api/mcp/auth_callback" },
      { provider: "chatgpt", redirectUri: "https://chatgpt.com/connector/oauth/*" },
      { provider: "gemini", redirectUri: "https://oauth-redirect.googleusercontent.com.example.test/r/observed" },
      { provider: "gemini", redirectUri: "https://oauth-redirect.googleusercontent.com/r/*" }]) {
      expect(() => planMcpClient({ ...config, ...mutation }, origin)).toThrow();
    }
    for (const target of ["http://pilot.example.test", origin + "/path", origin + "?x=1"]) expect(() => planMcpClient(config, target)).toThrow();
  });

  it("rejects a changed plan before opening a receipt or calling registration", async () => {
    const files = await fixture(), register = vi.fn();
    const plan = planMcpClient(config, origin);
    await expect(provisionMcpClient(plan, { ...files, register, confirmPlan: "wrong" })).rejects.toThrow("plan_confirmation_mismatch");
    plan.registration.scopes.push("notes:read");
    await expect(provisionMcpClient(plan, { ...files, register, confirmPlan: plan.sha256 })).rejects.toThrow("plan_confirmation_mismatch");
    expect(register).not.toHaveBeenCalled();
    await expect(readFile(files.receiptFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("journals before registration, excludes credentials and refuses reuse of an attempt receipt", async () => {
    const files = await fixture(), plan = planMcpClient(config, origin);
    const register = vi.fn(async (headers: Headers, input: unknown) => {
      expect(headers.get("cookie")).toBe("synthetic_session=private-canary");
      expect(headers.get("origin")).toBe(origin); expect(input).toEqual(plan.registration);
      expect(JSON.parse(await readFile(files.receiptFile, "utf8")).status).toBe("attempting");
      return { client_id: "public-client-id", client_secret: "never-copy-this" };
    });
    const options = { ...files, register, confirmPlan: plan.sha256 };
    const result = await provisionMcpClient(plan, options);
    expect(result).toMatchObject({ status: "registered", clientId: "public-client-id" });
    const receipt = await readFile(files.receiptFile, "utf8");
    expect(receipt).not.toMatch(/private-canary|never-copy-this|auth_callback/);
    expect(JSON.parse(receipt)).toMatchObject({ status: "registered", planSha256: plan.sha256 });
    await expect(provisionMcpClient(plan, options)).rejects.toMatchObject({ code: "EEXIST" });
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("retains an uncertain attempt without leaking a provider error or automatically replaying it", async () => {
    const files = await fixture(), plan = planMcpClient(config, origin);
    const register = vi.fn(async () => { throw new Error("credential-canary raw SQL/provider details"); });
    const options = { ...files, register, confirmPlan: plan.sha256 };
    await expect(provisionMcpClient(plan, options)).rejects.toThrow(/^registration_uncertain_inspect_receipt$/);
    const receipt = await readFile(files.receiptFile, "utf8");
    expect(JSON.parse(receipt)).toMatchObject({ status: "uncertain", action: "inspect_before_retry" });
    expect(receipt).not.toContain("credential-canary");
    await expect(provisionMcpClient(plan, options)).rejects.toMatchObject({ code: "EEXIST" });
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("bounds private input and rejects multi-header cookies before any mutation", async () => {
    const files = await fixture(), plan = planMcpClient(config, origin), register = vi.fn();
    await writeFile(files.cookieFile, "a=b\nAuthorization: secret");
    await expect(provisionMcpClient(plan, { ...files, register, confirmPlan: plan.sha256 })).rejects.toThrow("invalid_session_cookie_file");
    await writeFile(files.cookieFile, "x".repeat(8193));
    await expect(readMcpOperatorFile(files.cookieFile, 8192)).rejects.toThrow("invalid_operator_file");
    expect(register).not.toHaveBeenCalled();
    await expect(readFile(files.receiptFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
