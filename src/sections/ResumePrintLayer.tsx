import { useMemo } from "react";
import { createPortal } from "react-dom";
import { parseResumeDocument } from "../lib/resumeDocument";
import { ResumeDocument } from "./ResumeDocument";

// Off-screen copy of the tailored resume, portaled to <body> so it sits beside
// #root rather than deep in the app tree. Hidden on screen; print CSS hides #root
// and shows only this, so "PDF · clean" (window.print → Save as PDF) prints the
// resume in isolation regardless of which output tab is active.
export function ResumePrintLayer({ polishedText, sourceText }: { polishedText: string; sourceText?: string }) {
  const model = useMemo(() => parseResumeDocument(polishedText, sourceText), [polishedText, sourceText]);
  return createPortal(
    <div className="resume-print-layer" aria-hidden="true">
      <ResumeDocument model={model} />
    </div>,
    document.body
  );
}
