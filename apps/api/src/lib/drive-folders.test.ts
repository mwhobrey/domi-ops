import { describe, expect, it } from "vitest";
import {
  buildFolderBreadcrumb,
  childFolders,
  normalizeFolderName,
} from "./drive-folders.js";

const folders = [
  { id: "root-child", name: "Imports", parentId: null },
  { id: "nested", name: "Taxes", parentId: "root-child" },
  { id: "sibling", name: "Photos", parentId: null },
];

describe("drive folder helpers", () => {
  it("normalizes folder names", () => {
    expect(normalizeFolderName("  Docs  ")).toBe("Docs");
    expect(normalizeFolderName("")).toBeNull();
  });

  it("builds breadcrumb from root to nested folder", () => {
    expect(buildFolderBreadcrumb(folders, null)).toEqual([{ id: null, name: "Drive" }]);
    expect(buildFolderBreadcrumb(folders, "nested")).toEqual([
      { id: null, name: "Drive" },
      { id: "root-child", name: "Imports" },
      { id: "nested", name: "Taxes" },
    ]);
  });

  it("lists child folders for a parent", () => {
    expect(childFolders(folders, null).map((f) => f.name)).toEqual(["Imports", "Photos"]);
    expect(childFolders(folders, "root-child").map((f) => f.name)).toEqual(["Taxes"]);
  });
});
