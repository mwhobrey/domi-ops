import { describe, expect, it } from "vitest";
import { parseChoreTagsJson, serializeChoreTagsJson } from "./chores.js";

describe("chore list tag prefix", () => {
  it("parses list: prefix into list and remaining tags", () => {
    expect(parseChoreTagsJson('["list:Weekend","urgent"]')).toEqual({
      list: "Weekend",
      tags: ["urgent"],
    });
  });

  it("returns null list when no list tag", () => {
    expect(parseChoreTagsJson('["kitchen","urgent"]')).toEqual({
      list: null,
      tags: ["kitchen", "urgent"],
    });
  });

  it("serializes list and tags with list: prefix first", () => {
    expect(serializeChoreTagsJson("Todos", ["urgent"])).toBe('["list:Todos","urgent"]');
  });

  it("omits list tag when list is empty", () => {
    expect(serializeChoreTagsJson(null, ["urgent"])).toBe('["urgent"]');
    expect(serializeChoreTagsJson("", ["urgent"])).toBe('["urgent"]');
  });

  it("round-trips list and tags", () => {
    const raw = serializeChoreTagsJson("Shopping", ["weekly", "outdoor"]);
    expect(parseChoreTagsJson(raw)).toEqual({
      list: "Shopping",
      tags: ["weekly", "outdoor"],
    });
  });
});
