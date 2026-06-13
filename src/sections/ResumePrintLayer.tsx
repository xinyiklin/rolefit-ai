import { useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ResumeData } from "../lib/resumeData";
import { parseResumeDocument } from "../lib/resumeDocument";
import { ResumeDocument } from "./ResumeDocument";
import { ResumeReadonlyDocument } from "./ResumeReadonlyDocument";

// Off-screen copy of the tailored resume, portaled to <body> so it sits beside
// #root rather than deep in the app tree. Hidden on screen; print CSS hides #root
// and shows only this, so "PDF · clean" (window.print → Save as PDF) prints the
// resume in isolation regardless of which output tab is active.
//
// When the structured editor model is available (the normal case) we render it
// read-only with the SAME `.rdx-*` markup the editor uses, so the print matches
// what you edit exactly. The text-parse path stays as a fallback for the rare case
// where no structured model exists yet.
export function ResumePrintLayer({
  resume,
  polishedText,
  sourceText,
  docStyleVars
}: {
  resume: ResumeData | null;
  polishedText: string;
  sourceText?: string;
  // User typography (Format menu) — applied to the mirror so PDF · clean matches
  // the editor. The text-parse fallback keeps fixed styles.
  docStyleVars?: CSSProperties;
}) {
  const fallbackModel = useMemo(
    () => (resume ? null : parseResumeDocument(polishedText, sourceText)),
    [resume, polishedText, sourceText]
  );

  return createPortal(
    <div className="resume-print-layer" aria-hidden="true">
      {resume ? (
        <ResumeReadonlyDocument data={resume} style={docStyleVars} />
      ) : (
        <ResumeDocument model={fallbackModel!} />
      )}
    </div>,
    document.body
  );
}
