import { describe, expect, it } from "vitest";

import {
  canReadDrive,
  canWriteDrive,
  DEFAULT_DRIVE_ROLE_PERMISSIONS,
  parseDrivePermissionsJson,
  resolveDrivePermissionForRole,
  serializeDrivePermissionsJson,
} from "./drive-permissions.js";

describe("drive permissions", () => {
  it("defaults member=write, child=read, guest=read", () => {
    expect(DEFAULT_DRIVE_ROLE_PERMISSIONS).toEqual({
      member: "write",
      child: "read",
      guest: "read",
    });
    expect(canWriteDrive("member", DEFAULT_DRIVE_ROLE_PERMISSIONS)).toBe(true);
    expect(canWriteDrive("child", DEFAULT_DRIVE_ROLE_PERMISSIONS)).toBe(false);
    expect(canReadDrive("child", DEFAULT_DRIVE_ROLE_PERMISSIONS)).toBe(true);
    expect(canReadDrive("guest", DEFAULT_DRIVE_ROLE_PERMISSIONS)).toBe(true);
  });

  it("owner and admin always have write", () => {
    const perms = { member: "none", child: "none", guest: "none" } as const;
    expect(resolveDrivePermissionForRole("owner", perms)).toBe("write");
    expect(resolveDrivePermissionForRole("admin", perms)).toBe("write");
  });

  it("parses and serializes configurable roles", () => {
    const raw = '{"member":"read","child":"none","guest":"write"}';
    const parsed = parseDrivePermissionsJson(raw);
    expect(parsed.member).toBe("read");
    expect(parsed.child).toBe("none");
    expect(parsed.guest).toBe("write");
    expect(serializeDrivePermissionsJson(parsed)).toBe(
      '{"member":"read","child":"none","guest":"write"}',
    );
  });

  it("falls back to defaults on invalid JSON", () => {
    expect(parseDrivePermissionsJson("not-json")).toEqual(DEFAULT_DRIVE_ROLE_PERMISSIONS);
    expect(parseDrivePermissionsJson(null)).toEqual(DEFAULT_DRIVE_ROLE_PERMISSIONS);
  });
});
