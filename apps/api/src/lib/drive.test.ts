import { describe, expect, it } from "vitest";

import {
  driveObjectHasTag,
  driveObjectKey,
  driveObjectMatchesSearch,
  isDriveKeyForHousehold,
  normalizeDriveKind,
  normalizeDriveTitle,
  objectIdFromDriveKey,
  parseDriveTagsJson,
  serializeDriveTagsJson,
  validateDriveObjectFields,
} from "./drive.js";

const HOUSEHOLD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OBJECT_ID = "11111111-2222-3333-4444-555555555555";

describe("drive object keys", () => {
  it("builds household-scoped keys with sanitized filenames", () => {
    const key = driveObjectKey(HOUSEHOLD_ID, OBJECT_ID, "my file (1).pdf");
    expect(key).toBe(`drive/${HOUSEHOLD_ID}/${OBJECT_ID}/my_file_1_.pdf`);
    expect(isDriveKeyForHousehold(HOUSEHOLD_ID, key)).toBe(true);
    expect(isDriveKeyForHousehold(HOUSEHOLD_ID, `drive/other/${OBJECT_ID}/x.pdf`)).toBe(false);
    expect(objectIdFromDriveKey(HOUSEHOLD_ID, key)).toBe(OBJECT_ID);
  });
});

describe("drive kind validation", () => {
  it("accepts file and link kinds only", () => {
    expect(normalizeDriveKind("file")).toBe("file");
    expect(normalizeDriveKind("link")).toBe("link");
    expect(normalizeDriveKind("folder")).toBeNull();
  });

  it("requires url for link items", () => {
    expect(validateDriveObjectFields("link", { url: "https://example.com/doc" })).toBeNull();
    expect(validateDriveObjectFields("link", { url: "" })).toBe("url_required");
    expect(validateDriveObjectFields("link", { url: "not-a-url" })).toBe("invalid_url");
  });

  it("requires s3 metadata for file items", () => {
    const key = driveObjectKey(HOUSEHOLD_ID, OBJECT_ID, "readme.txt");
    expect(
      validateDriveObjectFields("file", {
        s3Key: key,
        contentType: "text/plain",
        byteSize: 42,
      }),
    ).toBeNull();
    expect(validateDriveObjectFields("file", { s3Key: key })).toBe("content_type_required");
    expect(validateDriveObjectFields("file", { s3Key: "", contentType: "text/plain", byteSize: 1 })).toBe(
      "s3_key_required",
    );
  });
});

describe("drive title and search", () => {
  it("normalizes titles", () => {
    expect(normalizeDriveTitle("  Tax docs  ")).toBe("Tax docs");
    expect(normalizeDriveTitle("   ")).toBeNull();
  });

  it("matches title, description, or filename", () => {
    expect(
      driveObjectMatchesSearch("Tax docs", "2024 returns", `drive/x/${OBJECT_ID}/w2.pdf`, "tax"),
    ).toBe(true);
    expect(
      driveObjectMatchesSearch("Menu", null, `drive/x/${OBJECT_ID}/grocery-list.pdf`, "grocery"),
    ).toBe(true);
    expect(
      driveObjectMatchesSearch("Menu", "chicken", `drive/x/${OBJECT_ID}/menu.pdf`, "beef"),
    ).toBe(false);
  });
});

describe("drive tags", () => {
  it("parses and serializes tag arrays", () => {
    expect(parseDriveTagsJson('["household", "taxes"]')).toEqual(["household", "taxes"]);
    expect(serializeDriveTagsJson([" taxes ", "household", ""])).toBe('["taxes","household"]');
  });

  it("matches tags case-insensitively", () => {
    expect(driveObjectHasTag('["Taxes"]', "taxes")).toBe(true);
    expect(driveObjectHasTag('["taxes"]', "school")).toBe(false);
  });
});
