import { ExternalLink, Link2, Unlink, Copy } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// The card shown for the hyperlink the caret is in, or the one the selection
// covers: where the link goes, plus the four things you might do about it.
// Purely presentational — resolving which link is the target belongs to
// useTypesetLinkCard, and the actions are the editor's own commands, so this
// cannot drift from what the toolbar and right-click menu do.
//
// It renders as a SIBLING of the editable page inside the positioned editor
// wrapper — the pattern the caret and structure overlays already use. Two reasons:
// controls must never live in the contenteditable DOM, where they would become
// document content the caret can enter and an edit can delete; and being inside
// the scrolling content means it stays on its link without a scroll listener.
export type TypesetLinkCardProps = {
  href: string;
  // Link-text rect relative to the editor wrapper; the card sits under it, or
  // above when it would not fit inside the wrapper.
  anchorRect: { left: number; top: number; bottom: number; right: number };
  onOpen: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDismiss: () => void;
};

const GAP = 6;
const PAD = 8;

// A long URL is shown head-and-tail rather than truncated, because the host says
// where you are going and the tail is what distinguishes two links to one site.
const MAX_HREF = 58;
function shortHref(href: string): string {
  const trimmed = href.replace(/^mailto:/, "");
  if (trimmed.length <= MAX_HREF) return trimmed;
  return `${trimmed.slice(0, MAX_HREF - 21)}…${trimmed.slice(-20)}`;
}

export function TypesetLinkCard({
  href,
  anchorRect,
  onOpen,
  onCopy,
  onEdit,
  onRemove,
  onDismiss
}: TypesetLinkCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Placed after measuring so it can flip above the link and stay inside the
  // wrapper; until then it renders hidden rather than in the wrong place. All the
  // geometry is wrapper-relative, so this never consults the viewport and the
  // placement cannot go stale when the page scrolls.
  useLayoutEffect(() => {
    const element = ref.current;
    const wrap = element?.offsetParent as HTMLElement | null;
    if (!element || !wrap) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const below = anchorRect.bottom + GAP;
    const fitsBelow = below + height <= wrap.offsetHeight - PAD;
    setPos({
      left: Math.max(PAD, Math.min(anchorRect.left, wrap.offsetWidth - width - PAD)),
      top: fitsBelow ? below : Math.max(PAD, anchorRect.top - GAP - height)
    });
  }, [anchorRect.bottom, anchorRect.left, anchorRect.top, href]);

  useEffect(() => {
    // Capture phase so Escape closes the card before the editor sees the key.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      className="ts-link-card"
      role="group"
      aria-label={`Link: ${href}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      // The card floats over the editable page; a click inside it must not move
      // the caret or collapse the selection its actions run against.
      onMouseDown={(event) => event.preventDefault()}
    >
      <a
        className="ts-link-card__href"
        href={href}
        target="_blank"
        rel="noreferrer"
        title={href}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        {shortHref(href)}
      </a>
      <div className="ts-link-card__actions">
        <button type="button" title="Open link" aria-label="Open link" onClick={onOpen}>
          <ExternalLink size={13} aria-hidden="true" />
        </button>
        <button type="button" title="Copy link" aria-label="Copy link" onClick={onCopy}>
          <Copy size={13} aria-hidden="true" />
        </button>
        <button type="button" title="Edit link" aria-label="Edit link" onClick={onEdit}>
          <Link2 size={13} aria-hidden="true" />
        </button>
        <button type="button" title="Remove link" aria-label="Remove link" onClick={onRemove}>
          <Unlink size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
