import { Fragment } from "react";
import { hasInlineMarkTags } from "@typeset/engine/lib/inlineMarksText.ts";

import { renderInlineMarks } from "../../lib/inlineMarks";
import { buildResumeDiff } from "../../resumeEngine";

// Which runs of the comparison a view keeps. "removed" reads as the text the
// document holds today, "added" as the text a decision would leave behind, and
// "merged" shows both at once for a whole-document replacement. One renderer
// for both documents is what makes a resume bullet and a cover letter mark a
// change the same way.
export type ProposalDiffMode = "removed" | "added" | "merged";

type ProposalDiffProps = {
  original: string;
  proposed: string;
  mode: ProposalDiffMode;
};

export function ProposalDiff({ original, proposed, mode }: ProposalDiffProps) {
  // Inline marks are a tag grammar, and a word-level diff can split a tag pair
  // across two segments — which would print the raw syntax at the seam. Marked
  // text therefore renders as its plain side rather than as broken markup.
  if (hasInlineMarkTags(original) || hasInlineMarkTags(proposed)) {
    return <>{renderInlineMarks(mode === "removed" ? original : proposed)}</>;
  }
  const { segments } = buildResumeDiff(original, proposed);
  return (
    <>
      {segments
        .filter((segment) => segment.type === "equal" || mode === "merged" || segment.type === mode)
        .map((segment, index) =>
          segment.type === "equal" ? (
            <Fragment key={index}>{renderInlineMarks(segment.text)}</Fragment>
          ) : (
            <span key={index} className={`proposal-diff__${segment.type}`}>
              {renderInlineMarks(segment.text)}
            </span>
          )
        )}
    </>
  );
}
