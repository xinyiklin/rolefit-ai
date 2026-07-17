import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { ResumeData } from "../lib/resumeData";
import { toTemplateSchema } from "../lib/resumeData";
import type { DocStyleIn } from "../typeset/blocks.ts";
import { TypesetDomPages } from "../typeset/render/dom.tsx";

// Off-screen copy of the tailored resume, portaled to <body> so it sits beside
// #root rather than deep in the app tree. Hidden on screen; print CSS hides
// #root and shows only this, so a manual browser print (⌘P → Save as PDF)
// yields the resume in isolation regardless of which output tab is active.
//
// The pages are painted by the typeset ENGINE's DOM backend (D013/D014) in
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
  docStyle: DocStyleIn;
}) {
  const schema = useMemo(() => toTemplateSchema(resume), [resume]);

  return createPortal(
    <div className="resume-print-layer" aria-hidden="true">
      <TypesetDomPages schema={schema} docStyle={docStyle} variant="print" />
    </div>,
    document.body
  );
}
