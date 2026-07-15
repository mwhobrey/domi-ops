import type { McOption, SchoolQuestionType } from "./school-test-questions.js";

export type ParsedImportQuestion = {
  questionType: SchoolQuestionType;
  promptMarkdown: string;
  points: number;
  optionsJson: McOption[] | null;
  correctAnswerJson: Record<string, unknown> | null;
  needsReview: boolean;
  parseNotes: string[];
};

const QUESTION_SPLIT = /(?:^|\n)\s*(\d+)[.)]\s+/;
const OPTION_LINE = /^\s*([a-dA-D])[.)]\s+(.+?)\s*$/;
const POINTS_IN_PROMPT = /(?:\[|\()\s*(\d+(?:\.\d+)?)\s*pts?\s*(?:\]|\))/i;
const ANSWER_LINE = /^\s*(?:answer|ans|correct)\s*[:\-]\s*(.+)\s*$/i;
const TRUE_FALSE_PROMPT = /\btrue\s*(?:or|\/)\s*false\b/i;
const ANSWER_KEY_HEADER = /^\s*(?:---+)?\s*answer\s*keys?\s*(?:\(.*?\))?\s*(?:---+)?\s*$/i;

/**
 * Soft-parse Google Doc / plain-text tests into draft native questions.
 * Unmatched or ambiguous blocks become long_answer + needsReview.
 */
export function parseGoogleDocTestText(plainText: string): {
  questions: ParsedImportQuestion[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const normalized = plainText.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return { questions: [], warnings: ["Document was empty"] };
  }

  const { body, answerKeyMap } = splitAnswerKey(normalized);
  const blocks = splitQuestionBlocks(body);
  if (blocks.length === 0) {
    warnings.push("No numbered questions found (expected 1. / 1) style)");
    return {
      questions: [
        {
          questionType: "long_answer",
          promptMarkdown: body.slice(0, 4000),
          points: 1,
          optionsJson: null,
          correctAnswerJson: null,
          needsReview: true,
          parseNotes: ["Fell back to single long-answer block"],
        },
      ],
      warnings,
    };
  }

  const questions = blocks.map((block, index) =>
    parseQuestionBlock(block, index + 1, answerKeyMap.get(index + 1)),
  );
  const reviewCount = questions.filter((q) => q.needsReview).length;
  if (reviewCount > 0) {
    warnings.push(`${reviewCount} question(s) need teacher review`);
  }
  return { questions, warnings };
}

function splitAnswerKey(text: string): {
  body: string;
  answerKeyMap: Map<number, string>;
} {
  const lines = text.split("\n");
  const keyIdx = lines.findIndex((line) => ANSWER_KEY_HEADER.test(line.trim()));
  if (keyIdx < 0) return { body: text, answerKeyMap: new Map() };

  const body = lines.slice(0, keyIdx).join("\n").trim();
  const keyLines = lines.slice(keyIdx + 1);
  const answerKeyMap = new Map<number, string>();
  for (const line of keyLines) {
    const m = line.match(/^\s*(\d+)[.)]\s*(.+?)\s*$/);
    if (m) answerKeyMap.set(Number(m[1]), m[2]!.trim());
  }
  return { body, answerKeyMap };
}

function splitQuestionBlocks(body: string): string[] {
  const parts = body.split(QUESTION_SPLIT);
  // split yields: [preamble, num1, block1, num2, block2, ...]
  const blocks: string[] = [];
  for (let i = 2; i < parts.length; i += 2) {
    const block = parts[i]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function parseQuestionBlock(
  block: string,
  number: number,
  keyHint: string | undefined,
): ParsedImportQuestion {
  const notes: string[] = [];
  const lines = block.split("\n").map((l) => l.trimEnd());
  const optionLines: Array<{ id: string; label: string }> = [];
  const contentLines: string[] = [];
  let inlineAnswer: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const opt = trimmed.match(OPTION_LINE);
    if (opt) {
      optionLines.push({ id: opt[1]!.toLowerCase(), label: opt[2]!.trim() });
      continue;
    }
    const ans = trimmed.match(ANSWER_LINE);
    if (ans) {
      inlineAnswer = ans[1]!.trim();
      continue;
    }
    contentLines.push(trimmed);
  }

  let prompt = contentLines.join("\n").trim() || `Question ${number}`;
  let points = 1;
  const ptsMatch = prompt.match(POINTS_IN_PROMPT);
  if (ptsMatch) {
    points = Number(ptsMatch[1]);
    prompt = prompt.replace(POINTS_IN_PROMPT, "").trim();
  }

  const answerText = (inlineAnswer ?? keyHint ?? "").trim();

  if (optionLines.length >= 2) {
    const optionsJson = optionLines.map((o) => ({ id: o.id, label: o.label }));
    const multi =
      /select all|all that apply|choose all/i.test(prompt) ||
      (answerText.includes(",") && answerText.split(/[,&]/).length > 1);
    const questionType: SchoolQuestionType = multi ? "multiple_choice_multi" : "multiple_choice";
    const correctAnswerJson = resolveMcAnswer(answerText, optionsJson, multi, notes);
    return {
      questionType,
      promptMarkdown: prompt,
      points,
      optionsJson,
      correctAnswerJson,
      needsReview: !correctAnswerJson || notes.length > 0,
      parseNotes: notes,
    };
  }

  if (
    TRUE_FALSE_PROMPT.test(prompt) ||
    /^(true|false|t|f)$/i.test(answerText)
  ) {
    const value = parseTrueFalse(answerText);
    return {
      questionType: "true_false",
      promptMarkdown: prompt.replace(TRUE_FALSE_PROMPT, "").trim() || prompt,
      points,
      optionsJson: null,
      correctAnswerJson: value == null ? null : { value },
      needsReview: value == null,
      parseNotes: value == null ? ["True/False answer not found — set in editor"] : notes,
    };
  }

  if (answerText) {
    return {
      questionType: "short_answer",
      promptMarkdown: prompt,
      points,
      optionsJson: null,
      correctAnswerJson: { accepted: [answerText] },
      needsReview: false,
      parseNotes: notes,
    };
  }

  notes.push("No options or answer found — imported as long answer");
  return {
    questionType: "long_answer",
    promptMarkdown: prompt,
    points,
    optionsJson: null,
    correctAnswerJson: null,
    needsReview: true,
    parseNotes: notes,
  };
}

function resolveMcAnswer(
  answerText: string,
  options: McOption[],
  multi: boolean,
  notes: string[],
): Record<string, unknown> | null {
  if (!answerText) {
    notes.push("No answer key for this question — set in editor");
    return null;
  }

  const tokens = answerText
    .split(/[,&;/]|and/i)
    .map((t) => t.trim())
    .filter(Boolean);

  const ids: string[] = [];
  for (const token of tokens) {
    const letter = token.match(/^([a-dA-D])(?:[).:]|$)/)?.[1]?.toLowerCase();
    if (letter && options.some((o) => o.id === letter)) {
      ids.push(letter);
      continue;
    }
    const byLabel = options.find((o) => o.label.toLowerCase() === token.toLowerCase());
    if (byLabel) {
      ids.push(byLabel.id);
      continue;
    }
    notes.push(`Could not map answer token "${token}"`);
  }

  if (ids.length === 0) {
    notes.push("Answer key present but not matched to options");
    return null;
  }

  if (multi) return { optionIds: [...new Set(ids)] };
  return { optionId: ids[0]! };
}

function parseTrueFalse(answerText: string): boolean | null {
  const t = answerText.trim().toLowerCase();
  if (!t) return null;
  if (/^(true|t|yes)$/.test(t)) return true;
  if (/^(false|f|no)$/.test(t)) return false;
  return null;
}
