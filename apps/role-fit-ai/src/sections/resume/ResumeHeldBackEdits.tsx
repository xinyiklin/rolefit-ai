import { useRef } from "react";
import { Undo2 } from "lucide-react";

import { ContentWarnings } from "../../components/ContentWarnings.tsx";
import { stripInlineMarks } from "../../lib/inlineMarks";
import type { ResumeHeldBackEdit, ResumeProposalSuggestion } from "../../resume/types";
import { ProposalDiff } from "../document/ProposalDiff";

type ResumeHeldBackEditsProps = {
  // Every edit the review held back, and the ones not yet restored.
  total: number;
  items: readonly ResumeHeldBackEdit[];
  disabled: boolean;
  locationOf: (suggestion: ResumeProposalSuggestion) => string;
  onRestore: (suggestionId: string) => void;
};

const REASON_LABELS: Record<ResumeHeldBackEdit["reason"], string> = {
  LOW_IMPACT: "Low impact",
  INCORRECT: "Likely incorrect"
};

// Several held-back edits can share an entry, so each Restore names its own text.
function restoreSubject(suggestion: ResumeProposalSuggestion): string {
  if (suggestion.kind === "reorder") return "new bullet order";
  const text = stripInlineMarks(suggestion.kind === "remove" ? suggestion.currentText : suggestion.proposedText).trim();
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
}

// Edits the opt-in review held back, folded away. Restore returns one to the
// proposal as an ordinary pending row; holding back verifies nothing.
export function ResumeHeldBackEdits({ total, items, disabled, locationOf, onRestore }: ResumeHeldBackEditsProps) {
  const summaryRef = useRef<HTMLElement>(null);
  if (!total) return null;
  return (
    <details className="resume-proposal__held-back">
      {/* The summary stays mounted after the last Restore, so focus has a home. */}
      <summary ref={summaryRef}>
        {items.length ? `${items.length} held back by review` : "Every held-back edit was restored"}
      </summary>
      {items.length ? (
        <ul>
          {items.map(({ suggestion, reason, note }) => {
            const location = locationOf(suggestion);
            return (
              <li key={suggestion.id}>
                <p className="resume-proposal__where">{location} · {REASON_LABELS[reason]}</p>
                {note ? <p className="resume-proposal__reason">Review note: {note}</p> : null}
                {suggestion.kind === "reorder" ? (
                  <p className="resume-proposal__reason">A new bullet order for this entry.</p>
                ) : suggestion.kind === "remove" ? (
                  <p className="resume-proposal__original is-removed">
                    <ProposalDiff original={suggestion.currentText} proposed="" mode="removed" />
                  </p>
                ) : (
                  <p className="resume-proposal__replacement">
                    <ProposalDiff original={suggestion.currentText} proposed={suggestion.proposedText} mode="added" />
                  </p>
                )}
                <ContentWarnings warnings={suggestion.warnings} />
                <button
                  className="ghost-button is-compact"
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onRestore(suggestion.id);
                    summaryRef.current?.focus();
                  }}
                >
                  <Undo2 size={13} aria-hidden="true" /> Restore
                  <span className="sr-only"> {location}: {restoreSubject(suggestion)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </details>
  );
}
