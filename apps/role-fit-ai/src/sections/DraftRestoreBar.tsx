// The recovered-draft offer both editors show. Floated as an overlay so
// appearing/dismissing never reflows the editor (it sits over the desk margin
// above the page). Extracted from ResumeTab when the cover letter gained the
// same recovery draft, so the two pages cannot drift into different recovery
// wording or behavior.

type DraftRestoreBarProps = {
  // What was recovered, e.g. "Unsaved draft" / "Unsaved cover letter".
  label: string;
  // Job target the draft was written against (role · company), when known.
  jobLabel?: string;
  savedAt: string;
  onRestore: () => void;
  onDismiss: () => void;
};

export function DraftRestoreBar({ label, jobLabel, savedAt, onRestore, onDismiss }: DraftRestoreBarProps) {
  return (
    <div className="draft-restore-bar" role="alert">
      <span className="draft-restore-bar__text">
        {label}
        {jobLabel ? ` · ${jobLabel}` : ""}
        {" "}
        <span className="draft-restore-bar__time">
          {new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </span>
      <button type="button" className="ghost-button is-compact draft-restore-bar__action" onClick={onRestore}>
        Restore
      </button>
      <button
        type="button"
        className="ghost-button is-compact draft-restore-bar__dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
