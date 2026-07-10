import { describe, expect, it } from "vitest";
import { getMaterialActionLabel, materialOpenUrl } from "./school-materials";

describe("school-materials web helpers", () => {
  it("labels test materials", () => {
    expect(getMaterialActionLabel({ role: "handout", isTest: true })).toBe("Open test");
  });

  it("uses snapshot url when frozen", () => {
    const url = materialOpenUrl("asn-1", {
      id: "mat-1",
      assignmentId: "asn-1",
      role: "handout",
      source: "domi_drive_file",
      displayName: "Worksheet",
      sortOrder: 0,
      driveObjectId: "drive-1",
      externalUrl: null,
      isTest: true,
      studentVisible: true,
      observerVisible: false,
      frozenAt: "2026-01-01T00:00:00.000Z",
      hasSnapshot: true,
      driveObject: null,
    });
    expect(url).toBe("/api/school/assignments/asn-1/materials/mat-1/snapshot");
  });
});
