import { describe, expect, it } from "vitest";
import {
  compareTemplateContent,
  mergeLineageResults,
  verifyGoogleSubmissionLineage,
} from "./school-google-lineage.js";

describe("verifyGoogleSubmissionLineage", () => {
  const copyRow = {
    studentGoogleFileId: "student-copy-1",
    materialId: "mat-1",
    templateGoogleFileId: "template-1",
  };

  it("passes when picked file matches student copy", () => {
    const result = verifyGoogleSubmissionLineage({
      pickedFileId: "student-copy-1",
      copyRow,
    });
    expect(result.status).toBe("pass");
  });

  it("passes when appProperties match copy row", () => {
    const result = verifyGoogleSubmissionLineage({
      pickedFileId: "other-file",
      copyRow,
      appProperties: {
        domi_ops_material_id: "mat-1",
        domi_ops_template_file_id: "template-1",
      },
    });
    expect(result.status).toBe("pass");
  });

  it("warns when appProperties mismatch copy row", () => {
    const result = verifyGoogleSubmissionLineage({
      pickedFileId: "other-file",
      copyRow,
      appProperties: {
        domi_ops_material_id: "mat-2",
        domi_ops_template_file_id: "template-1",
      },
    });
    expect(result.status).toBe("warn");
  });

  it("fails when file does not match copy or properties", () => {
    const result = verifyGoogleSubmissionLineage({
      pickedFileId: "unrelated",
      copyRow: null,
    });
    expect(result.status).toBe("fail");
  });
});

describe("compareTemplateContent", () => {
  it("passes when submission includes full template", () => {
    const result = compareTemplateContent(
      "Question 1\nAnswer: foo\nQuestion 2\nAnswer: bar",
      "Question 1\nQuestion 2",
    );
    expect(result.status).toBe("pass");
  });

  it("warns when template is partially preserved", () => {
    const result = compareTemplateContent(
      "Question 1\nAnswer: foo\nQuestion 2\nAnswer: bar",
      "Question 1\nQuestion 2\nQuestion 3\nQuestion 4",
    );
    expect(result.status).toBe("warn");
  });

  it("fails when most template content is removed", () => {
    const result = compareTemplateContent("Answer only", "Line A\nLine B\nLine C\nLine D");
    expect(result.status).toBe("fail");
  });
});

describe("mergeLineageResults", () => {
  it("prefers fail over warn and pass", () => {
    const result = mergeLineageResults([
      { status: "pass", detail: "ok" },
      { status: "warn", detail: "hmm" },
      { status: "fail", detail: "bad" },
    ]);
    expect(result.status).toBe("fail");
    expect(result.detail).toBe("bad");
  });

  it("prefers warn over pass", () => {
    const result = mergeLineageResults([
      { status: "pass", detail: "ok" },
      { status: "warn", detail: "review" },
    ]);
    expect(result.status).toBe("warn");
  });
});
