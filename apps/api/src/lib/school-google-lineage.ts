import { normalizeTextForHash } from "./school-material-freeze.js";

export type LineageStatus = "unknown" | "pass" | "warn" | "fail";

export function verifyGoogleSubmissionLineage(params: {
  pickedFileId: string;
  copyRow?: {
    studentGoogleFileId: string;
    materialId: string;
    templateGoogleFileId: string;
  } | null;
  appProperties?: Record<string, string> | null;
}): { status: LineageStatus; detail: string } {
  if (
    params.copyRow &&
    params.pickedFileId === params.copyRow.studentGoogleFileId
  ) {
    return { status: "pass", detail: "Matches student copy from Start test" };
  }

  const props = params.appProperties;
  if (props?.domi_ops_material_id && props?.domi_ops_template_file_id) {
    if (
      params.copyRow &&
      props.domi_ops_material_id === params.copyRow.materialId &&
      props.domi_ops_template_file_id === params.copyRow.templateGoogleFileId
    ) {
      return { status: "pass", detail: "Drive appProperties match assignment material" };
    }
    return { status: "warn", detail: "Drive appProperties present but copy record mismatch" };
  }

  return { status: "fail", detail: "Submitted file does not match student test copy" };
}

export function compareTemplateContent(
  submittedText: string,
  templateText: string,
): { status: LineageStatus; detail: string } {
  const submitted = normalizeTextForHash(submittedText);
  const template = normalizeTextForHash(templateText);
  if (!template) {
    return { status: "warn", detail: "No template text available for comparison" };
  }
  if (submitted.includes(template)) {
    return { status: "pass", detail: "Template content preserved in submission" };
  }
  const templateLines = template.split("\n").filter((line) => line.trim().length > 0);
  const preserved = templateLines.filter((line) => submitted.includes(line)).length;
  const ratio = templateLines.length ? preserved / templateLines.length : 0;
  if (ratio >= 0.8) {
    return { status: "pass", detail: "Most template content preserved in submission" };
  }
  if (ratio >= 0.5) {
    return { status: "warn", detail: "Template content partially modified" };
  }
  return { status: "fail", detail: "Template content significantly changed or removed" };
}

export function mergeLineageResults(
  results: Array<{ status: LineageStatus; detail: string }>,
): { status: LineageStatus; detail: string } {
  if (results.some((r) => r.status === "fail")) {
    const fail = results.find((r) => r.status === "fail");
    return fail ?? { status: "fail", detail: "Lineage check failed" };
  }
  if (results.some((r) => r.status === "warn")) {
    const warn = results.find((r) => r.status === "warn");
    return warn ?? { status: "warn", detail: "Lineage check needs review" };
  }
  if (results.some((r) => r.status === "pass")) {
    return results.find((r) => r.status === "pass") ?? { status: "pass", detail: "Lineage OK" };
  }
  return { status: "unknown", detail: "Lineage not verified" };
}
