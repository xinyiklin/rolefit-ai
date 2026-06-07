import { normalizeText, stripBullet } from "./text";
import type { DiffSegment, ResumeDiff } from "./types";

function comparableLine(line: string) {
  return normalizeText(
    stripBullet(line)
      .replace(/\[add metric:[^\]]+\]/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// A single diff unit: `key` drives equality during alignment, `text` is what we
// render (it carries the original spacing/newlines so the output reconstructs
// the resume faithfully).
type DiffToken = { key: string; text: string };

// Split text into word and newline tokens, folding each non-newline whitespace
// run onto the following token's rendered text. `key` is the bare word (or "\n")
// so reindentation alone does not register as a change, while `text` preserves
// the spacing needed to rebuild the document.
function tokenizeForDiff(text: string): DiffToken[] {
  const raw = text.match(/\n|[^\S\n]+|\S+/g) ?? [];
  const tokens: DiffToken[] = [];
  let pendingWhitespace = "";
  for (const piece of raw) {
    if (piece === "\n") {
      tokens.push({ key: "\n", text: `${pendingWhitespace}\n` });
      pendingWhitespace = "";
    } else if (/^[^\S\n]+$/.test(piece)) {
      pendingWhitespace += piece;
    } else {
      tokens.push({ key: piece, text: `${pendingWhitespace}${piece}` });
      pendingWhitespace = "";
    }
  }
  if (pendingWhitespace) tokens.push({ key: " ", text: pendingWhitespace });
  return tokens;
}

// Whole-line tokens for the large-document fallback path: cheaper to align when
// the word-level matrix would be too big to hold.
function tokenizeLinesForDiff(text: string): DiffToken[] {
  return text.split("\n").map((line) => ({ key: comparableLine(line), text: `${line}\n` }));
}

// Classic longest-common-subsequence alignment. Returns the merged op list
// walking both sequences; `removed` indices point into `a`, `added` into `b`.
function diffTokens(
  a: DiffToken[],
  b: DiffToken[]
): Array<{ type: DiffSegment["type"]; index: number }> {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i].key === b[j].key
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops: Array<{ type: DiffSegment["type"]; index: number }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) {
      ops.push({ type: "equal", index: j });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ type: "removed", index: i });
      i++;
    } else {
      ops.push({ type: "added", index: j });
      j++;
    }
  }
  while (i < n) ops.push({ type: "removed", index: i++ });
  while (j < m) ops.push({ type: "added", index: j++ });
  return ops;
}

function opsToSegments(
  ops: Array<{ type: DiffSegment["type"]; index: number }>,
  a: DiffToken[],
  b: DiffToken[]
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };
  for (const op of ops) {
    if (op.type === "removed") push("removed", a[op.index].text);
    else push(op.type, b[op.index].text);
  }
  return segments;
}

// Above this many DP cells (~2000x2000 tokens) the word-level matrix gets too
// large to hold comfortably in the browser, so fall back to a line-level diff —
// still complete, just coarser.
const WORD_DIFF_CELL_LIMIT = 4_000_000;

// Build an inline before/after diff of the whole resume so the user can see and
// vet every change the AI made — additions are highlighted, removals struck
// through — rather than trusting a summary. No truncation: the full document is
// returned and the view scrolls.
export function buildResumeDiff(sourceText: string, polishedText: string): ResumeDiff {
  const metricPrompts = polishedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\[add metric:/i.test(line))
    .slice(0, 6);

  const sourceWords = tokenizeForDiff(sourceText);
  const polishedWords = tokenizeForDiff(polishedText);
  const useWordDiff =
    (sourceWords.length + 1) * (polishedWords.length + 1) <= WORD_DIFF_CELL_LIMIT;
  const source = useWordDiff ? sourceWords : tokenizeLinesForDiff(sourceText);
  const polished = useWordDiff ? polishedWords : tokenizeLinesForDiff(polishedText);
  const segments = opsToSegments(diffTokens(source, polished), source, polished);

  return { segments, metricPrompts };
}
