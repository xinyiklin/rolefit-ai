// True when the polished output is itself a LaTeX document (preserve-format on a
// .tex source returns the edited .tex). Drives in-place export that bypasses the
// template renderer.
export function looksLikeLatex(text: string): boolean {
  return /\\documentclass|\\begin\{document\}/.test(text);
}

