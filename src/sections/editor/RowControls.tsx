import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from "lucide-react";

// Drag handle + add + remove, shared by sections, entries, skill rows, and
// bullets. The cluster lives in the page's right margin (vertical stack — see
// resume-editor.css) so it never covers row text; it stays quiet until the row
// is hovered or focused. Reordering is the grip alone: drag with the pointer,
// or focus it and press Space/Enter then the arrow keys (dnd-kit keyboard
// sensor) — the old explicit up/down buttons duplicated that and made the
// cluster wide enough to overlap content. The add affordance is folded in here
// (one gutter cluster per row) instead of separate floating "+" buttons that
// shared the margin and collided with this stack.
//
// Remove is a two-step confirm: the first click arms it (the group becomes a
// "Remove X? ✓ ✗" prompt), the second confirms. This guards against a one-click,
// hover-revealed delete — especially a section delete, which cascades through all
// its entries and bullets and has no undo.
type RowControlsProps = {
  label: string;
  onRemove: () => void;
  onAdd?: () => void;
  addLabel?: string;
  dragHandle?: ReactNode;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

export function RowControls({ label, onRemove, onAdd, addLabel, dragHandle, onMoveUp, onMoveDown }: RowControlsProps) {
  const [confirming, setConfirming] = useState(false);

  // Auto-disarm so a forgotten confirm doesn't linger as a live delete.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (confirming) {
    return (
      <div className="rdx-controls rdx-controls--confirm" role="group" aria-label={`Confirm removing ${label}`}>
        <span className="rdx-controls__confirm-label">Remove {label}?</span>
        <button
          type="button"
          className="rdx-iconbtn rdx-iconbtn--danger"
          onClick={onRemove}
          title={`Confirm — remove ${label}`}
          aria-label={`Confirm — remove ${label}`}
        >
          <Check size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rdx-iconbtn"
          onClick={() => setConfirming(false)}
          title="Keep it"
          aria-label={`Cancel — keep ${label}`}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="rdx-controls" role="group" aria-label={`${label} controls`}>
      {dragHandle}
      {onMoveUp ? (
        <button type="button" className="rdx-iconbtn" onClick={onMoveUp} title={`Move ${label} up`} aria-label={`Move ${label} up`}>
          <ArrowUp size={13} aria-hidden="true" />
        </button>
      ) : null}
      {onMoveDown ? (
        <button type="button" className="rdx-iconbtn" onClick={onMoveDown} title={`Move ${label} down`} aria-label={`Move ${label} down`}>
          <ArrowDown size={13} aria-hidden="true" />
        </button>
      ) : null}
      {onAdd ? (
        <button
          type="button"
          className="rdx-iconbtn"
          onClick={onAdd}
          title={addLabel ?? `Add ${label}`}
          aria-label={addLabel ?? `Add ${label}`}
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="rdx-iconbtn rdx-iconbtn--danger"
        onClick={() => setConfirming(true)}
        title={`Remove ${label}`}
        aria-label={`Remove ${label}`}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
