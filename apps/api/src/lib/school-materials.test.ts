import { describe, expect, it } from "vitest";
import {
  attemptsRemaining,
  defaultVisibilityForRole,
  isAttemptsExhausted,
  materialVisibleToViewer,
  validateMaterialInput,
} from "./school-materials.js";

describe("materialVisibleToViewer", () => {
  const handout = {
    role: "handout" as const,
    studentVisible: true,
    observerVisible: false,
  };

  it("hides answer_key from students and observers", () => {
    const key = { role: "answer_key" as const, studentVisible: false, observerVisible: false };
    expect(materialVisibleToViewer(key, "student")).toBe(false);
    expect(materialVisibleToViewer(key, "observer")).toBe(false);
    expect(materialVisibleToViewer(key, "staff")).toBe(true);
  });

  it("student sees when student_visible", () => {
    expect(materialVisibleToViewer(handout, "student")).toBe(true);
    expect(
      materialVisibleToViewer({ ...handout, studentVisible: false }, "student"),
    ).toBe(false);
  });

  it("observer sees student_visible or observer_visible", () => {
    expect(materialVisibleToViewer(handout, "observer")).toBe(true);
    expect(
      materialVisibleToViewer(
        { role: "rubric", studentVisible: false, observerVisible: true },
        "observer",
      ),
    ).toBe(true);
    expect(
      materialVisibleToViewer(
        { role: "rubric", studentVisible: false, observerVisible: false },
        "observer",
      ),
    ).toBe(false);
  });
});

describe("validateMaterialInput", () => {
  it("rejects student_visible on answer_key", () => {
    const result = validateMaterialInput(
      {
        role: "answer_key",
        source: "external_url",
        displayName: "Key",
        externalUrl: "https://example.com",
        studentVisible: true,
      },
      { isCreate: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("answer_key_not_student_visible");
  });

  it("rejects mutating frozen material", () => {
    const result = validateMaterialInput({ role: "handout" }, { isFrozen: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("material_frozen");
  });

  it("requires google_file_id for google_doc create", () => {
    const result = validateMaterialInput(
      { source: "google_doc", displayName: "Worksheet" },
      { isCreate: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("google_file_required");
  });

  it("accepts native_test create without drive or google", () => {
    const result = validateMaterialInput(
      { source: "native_test", displayName: "Quiz 1" },
      { isCreate: true },
    );
    expect(result.ok).toBe(true);
  });
});

describe("defaultVisibilityForRole", () => {
  it("answer_key defaults hidden", () => {
    expect(defaultVisibilityForRole("answer_key")).toEqual({
      studentVisible: false,
      observerVisible: false,
    });
  });
});

describe("attemptsRemaining", () => {
  it("unlimited when max null", () => {
    expect(attemptsRemaining(null, 5)).toBeNull();
    expect(isAttemptsExhausted(null, 99)).toBe(false);
  });

  it("counts down", () => {
    expect(attemptsRemaining(3, 1)).toBe(2);
    expect(isAttemptsExhausted(3, 3)).toBe(true);
  });
});
