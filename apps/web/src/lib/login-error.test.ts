import { describe, expect, it } from "vitest";
import { loginErrorCode } from "./login-error";

describe("loginErrorCode", () => {
  it("returns nothing when there is no error", () => {
    expect(loginErrorCode(undefined)).toBeNull();
    expect(loginErrorCode("")).toBeNull();
    expect(loginErrorCode([])).toBeNull();
    expect(loginErrorCode(["", "  "])).toBeNull();
  });

  it("returns a single code as it is", () => {
    expect(loginErrorCode("state_mismatch")).toBe("state_mismatch");
    expect(loginErrorCode("oauth")).toBe("oauth");
    expect(loginErrorCode("no-household")).toBe("no-household");
  });

  it("prefers the real code over the generic oauth placeholder when both arrive", () => {
    expect(loginErrorCode(["oauth", "internal_server_error"])).toBe("internal_server_error");
    expect(loginErrorCode(["internal_server_error", "oauth"])).toBe("internal_server_error");
  });

  it("takes the last of several real codes, and keeps oauth when it is all there is", () => {
    expect(loginErrorCode(["state_mismatch", "internal_server_error"])).toBe("internal_server_error");
    expect(loginErrorCode(["oauth", "oauth"])).toBe("oauth");
  });
});
