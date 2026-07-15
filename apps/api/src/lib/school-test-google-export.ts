import type { SchoolQuestionType } from "./school-test-questions.js";
import type { McOption } from "./school-test-questions.js";

export type ExportableQuestion = {
  sortOrder: number;
  questionType: SchoolQuestionType;
  promptMarkdown: string;
  points: number | null;
  weight: number | null;
  optionsJson: McOption[] | null;
  correctAnswerJson: Record<string, unknown> | null;
};

function pointsLabel(q: ExportableQuestion): string {
  if (q.points != null) return ` (${q.points} pt${q.points === 1 ? "" : "s"})`;
  if (q.weight != null) return ` (weight ${q.weight})`;
  return "";
}

function optionLetter(index: number): string {
  return String.fromCharCode(97 + index); // a, b, c...
}

function formatCorrectAnswer(q: ExportableQuestion): string {
  const key = q.correctAnswerJson;
  if (!key) return "(manual / no key)";
  if (q.questionType === "multiple_choice") {
    const id = typeof key.optionId === "string" ? key.optionId : null;
    const opt = q.optionsJson?.find((o) => o.id === id);
    return opt ? `${opt.id}) ${opt.label}` : id ?? "(unset)";
  }
  if (q.questionType === "multiple_choice_multi") {
    const ids = Array.isArray(key.optionIds)
      ? key.optionIds.filter((v): v is string => typeof v === "string")
      : [];
    return ids
      .map((id) => {
        const opt = q.optionsJson?.find((o) => o.id === id);
        return opt ? `${opt.id}) ${opt.label}` : id;
      })
      .join(", ");
  }
  if (q.questionType === "true_false") {
    return key.value === true ? "True" : key.value === false ? "False" : "(unset)";
  }
  if (q.questionType === "short_answer") {
    const accepted = Array.isArray(key.accepted)
      ? key.accepted.filter((v): v is string => typeof v === "string")
      : typeof key.text === "string"
        ? [key.text]
        : [];
    return accepted.filter(Boolean).join(" / ") || "(unset)";
  }
  return "(manual)";
}

export function formatNativeTestPlainText(params: {
  assignmentTitle: string;
  testTitle: string;
  questions: ExportableQuestion[];
  includeAnswerKey: boolean;
}): string {
  const lines: string[] = [
    params.assignmentTitle,
    params.testTitle,
    "",
  ];

  const sorted = [...params.questions].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < sorted.length; i++) {
    const q = sorted[i]!;
    lines.push(`${i + 1}. ${q.promptMarkdown.trim()}${pointsLabel(q)}`);
    if (q.questionType === "multiple_choice" || q.questionType === "multiple_choice_multi") {
      for (const [idx, opt] of (q.optionsJson ?? []).entries()) {
        lines.push(`   ${optionLetter(idx)}) ${opt.label}`);
      }
      if (q.questionType === "multiple_choice_multi") {
        lines.push("   (Select all that apply)");
      }
    } else if (q.questionType === "true_false") {
      lines.push("   ____ True     ____ False");
    } else if (q.questionType === "short_answer") {
      lines.push("   ________________________________");
    } else {
      lines.push("   (Write your answer below)");
      lines.push("");
      lines.push("");
    }
    lines.push("");
  }

  if (params.includeAnswerKey) {
    lines.push("--- Answer Key (teacher only) ---");
    lines.push("");
    for (let i = 0; i < sorted.length; i++) {
      const q = sorted[i]!;
      lines.push(`${i + 1}. ${formatCorrectAnswer(q)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatNativeTestHtml(params: {
  assignmentTitle: string;
  testTitle: string;
  questions: ExportableQuestion[];
  includeAnswerKey: boolean;
}): string {
  const sorted = [...params.questions].sort((a, b) => a.sortOrder - b.sortOrder);
  const questionBlocks = sorted
    .map((q, i) => {
      let body = `<p><strong>${i + 1}.</strong> ${escapeHtml(q.promptMarkdown.trim())}${escapeHtml(pointsLabel(q))}</p>`;
      if (q.questionType === "multiple_choice" || q.questionType === "multiple_choice_multi") {
        body += "<ul>";
        for (const [idx, opt] of (q.optionsJson ?? []).entries()) {
          body += `<li>${escapeHtml(optionLetter(idx))}) ${escapeHtml(opt.label)}</li>`;
        }
        body += "</ul>";
        if (q.questionType === "multiple_choice_multi") {
          body += "<p><em>Select all that apply</em></p>";
        }
      } else if (q.questionType === "true_false") {
        body += "<p>____ True &nbsp;&nbsp; ____ False</p>";
      } else if (q.questionType === "short_answer") {
        body += "<p>________________________________</p>";
      } else {
        body += "<p><em>Write your answer below.</em></p><p><br/><br/></p>";
      }
      return body;
    })
    .join("\n");

  let answerKey = "";
  if (params.includeAnswerKey) {
    answerKey =
      "<hr/><h2>Answer Key (teacher only)</h2><ol>" +
      sorted
        .map((q) => `<li>${escapeHtml(formatCorrectAnswer(q))}</li>`)
        .join("") +
      "</ol>";
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(params.testTitle)}</title></head>
<body>
<h1>${escapeHtml(params.assignmentTitle)}</h1>
<h2>${escapeHtml(params.testTitle)}</h2>
${questionBlocks}
${answerKey}
</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
