import { useDeferredValue, useMemo } from "react";
import { createPortal } from "react-dom";
import type { ResumeData } from "@typeset/engine/lib/resumeData";
import type { DocumentStyle } from "@typeset/engine/lib/documentStyle";
import { TypesetDomPages } from "@typeset/engine/typeset/render/dom";
import { toTypesetSchema } from "@typeset/engine/typeset/schema";

// Off-screen copy of the current resume, portaled to <body> so it sits beside
// #root rather than deep in the app tree. Hidden on screen; print CSS hides
// #root and shows only this, so a manual browser print (⌘P → Save as PDF)
// yields the resume in isolation regardless of which output tab is active.
//
// The pages are painted by the typeset ENGINE's DOM backend in
// true pt units — identical layout to the engine PDF and the preview overlay,
// as real selectable text. Printing starts only once the structured model
// exists, so there is no second parser or fallback layout to drift.
export function ResumePrintLayer({
  resume,
  docStyle
}: {
  resume: ResumeData;
  // Format/Style-menu values — the engine lays the printed page out with the
  // same rhythm the editor and exports use.
  docStyle: DocumentStyle;
}) {
  // This layer is only visible while printing, so its relayout may lag the
  // editor's: deferring keeps rapid typing from running the layout engine
  // twice per keystroke, and the deferred value has always settled by the
  // time a print dialog can open.
  const deferredResume = useDeferredValue(resume);
  const deferredStyle = useDeferredValue(docStyle);
  const schema = useMemo(() => toTypesetSchema(deferredResume), [deferredResume]);

  return createPortal(
    <div className="resume-print-layer" aria-hidden="true">
      <TypesetDomPages schema={schema} docStyle={deferredStyle} variant="print" />
    </div>,
    document.body
  );
}
