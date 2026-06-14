import type { ResumeBlock, ResumeBlockKind } from "../sections/shared";

export function classifyResumeLine(line: string, index: number): ResumeBlockKind {
  const trimmed = line.trim();
  if (index <= 1 && /@|linkedin|github|\b\d{3}[-.)\s]?\d{3}[-.\s]?\d{4}\b/i.test(trimmed)) return "contact";
  if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(trimmed)) return "bullet";
  if (trimmed.length <= 42 && /^[A-Z0-9/&,\- ]+$/.test(trimmed) && /[A-Z]/.test(trimmed)) return "section";
  return "text";
}

export function buildResumeBlocks(text: string): ResumeBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `${index}-${line.slice(0, 24).replace(/[^a-z0-9]+/gi, "-")}`,
      kind: classifyResumeLine(line, index),
      text: line
    }));
}
