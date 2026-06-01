// True when the polished output is itself a LaTeX document (preserve-format on a
// .tex source returns the edited .tex). Drives in-place export that bypasses the
// template renderer.
export function looksLikeLatex(text: string): boolean {
  return /\\documentclass|\\begin\{document\}/.test(text);
}

// Best-effort source format so the AI knows what file type the resume came
// from even when nothing is uploaded (pasted text, reloaded workspace base).
export function describeResumeFormat(fileName: string, hasSourceDocx: boolean, resumeText = ""): string {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  switch (ext) {
    case "docx":
      return "DOCX (Word)";
    case "pdf":
      return "PDF";
    case "tex":
      return "LaTeX";
    case "md":
      return "Markdown";
    case "csv":
      return "CSV";
    case "txt":
      return "Plain text";
    case "":
      if (hasSourceDocx) return "DOCX (Word)";
      return looksLikeLatex(resumeText) ? "LaTeX" : "Plain text (pasted)";
    default:
      return ext.toUpperCase();
  }
}
