// The link card's target: the hyperlink the CARET is inside, or the one the
// selection covers.
//
// It used to follow the pointer. Hover is the wrong trigger for an editor: it
// fires while the user is reading rather than acting, it cannot be reached from
// the keyboard, and it competes for the pointer with selection dragging. Driving
// it from the selection means the card describes the link you are working on, and
// it appears for a keyboard user too.
//
// The run is resolved with expandToLinkRun — the SAME resolver the toolbar's link
// control and the right-click menu use — so all three agree on what "the link
// here" means, including expanding a partial selection or a bare caret to the
// whole link.

import { useCallback, useRef, useState } from "react";

import type { FieldSrc } from "@typeset/engine/typeset/types.ts";

import { displayRangeRect } from "./domSelection.ts";
import { expandToLinkRun, type TypesetSelection } from "./inlineTextEditing.ts";

// Anchor geometry relative to the editor WRAPPER, not the viewport.
//
// The card is a sibling of the contenteditable host inside `.typeset-editor`
// (which is position: relative) — the same pattern the caret overlay and the
// structure overlay use. Wrapper-relative coordinates scroll with the page for
// free, so the card needs no scroll listener to stay on its link. That matters
// beyond tidiness: scroll events are paint-gated, so a viewport-anchored card
// silently detaches from its link in any context where they do not fire.
type AnchorRect = { left: number; top: number; right: number; bottom: number };

export type LinkCardTarget = {
  href: string;
  key: string;
  src: FieldSrc;
  dStart: number;
  dEnd: number;
  anchorRect: AnchorRect;
};

// Every setTarget goes through this. Returning the SAME object when nothing moved
// keeps the card out of the render loop: it is re-measured from an effect that
// runs on every repaint, and handing back a fresh object each time would
// re-render, re-measure, and re-render again without end.
function sameTarget(left: LinkCardTarget | null, right: LinkCardTarget | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.href === right.href &&
    left.key === right.key &&
    left.dStart === right.dStart &&
    left.dEnd === right.dEnd &&
    Math.abs(left.anchorRect.left - right.anchorRect.left) < 0.01 &&
    Math.abs(left.anchorRect.top - right.anchorRect.top) < 0.01 &&
    Math.abs(left.anchorRect.right - right.anchorRect.right) < 0.01 &&
    Math.abs(left.anchorRect.bottom - right.anchorRect.bottom) < 0.01
  );
}

type LinkCardArgs = {
  hostRef: React.RefObject<HTMLDivElement | null>;
  // The positioned ancestor the card is placed inside.
  wrapRef: React.RefObject<HTMLDivElement | null>;
};

// Viewport rect -> wrapper-relative rect. Both move together under scroll, so the
// difference is scroll-invariant and the card stays glued to its link.
function wrapperRect(
  wrap: HTMLElement | null,
  rect: AnchorRect | null
): AnchorRect | null {
  if (!wrap || !rect) return null;
  const origin = wrap.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top
  };
}

export function useTypesetLinkCard({ hostRef, wrapRef }: LinkCardArgs) {
  const [target, setTarget] = useState<LinkCardTarget | null>(null);
  // Escape dismisses the card for the CURRENT run without moving the caret. Held
  // by run identity so moving to another link (or back to this one) shows it again
  // and the dismissal cannot become sticky.
  const dismissedRef = useRef<string | null>(null);

  const hide = useCallback(() => setTarget(null), []);

  const dismiss = useCallback(() => {
    setTarget((current) => {
      if (current) dismissedRef.current = `${current.key}:${current.dStart}:${current.dEnd}`;
      return null;
    });
  }, []);

  // Recompute from the selection the editor has already resolved. Called from the
  // editor's existing selection-change effect, so this does no selection reading
  // of its own and cannot disagree with the rest of the editor about where the
  // caret is.
  //
  // `deferredLinkKey` is the field whose in-progress URL is having its auto-link
  // visually deferred. The stored value has no <nolink> yet (suppression is
  // render-only), so expandToLinkRun WOULD resolve the half-typed URL and pop the
  // card up mid-word. That field is skipped for exactly as long as the paint
  // defers the link.
  const sync = useCallback(
    (selection: TypesetSelection | null, deferredLinkKey: string | null) => {
      const host = hostRef.current;
      if (!host || !selection || selection.key === deferredLinkKey) {
        dismissedRef.current = null;
        setTarget(null);
        return;
      }
      const run = expandToLinkRun(selection.map, selection.dStart, selection.dEnd);
      if (!run) {
        dismissedRef.current = null;
        setTarget(null);
        return;
      }
      const identity = `${selection.key}:${run.start}:${run.end}`;
      if (dismissedRef.current === identity) {
        setTarget(null);
        return;
      }
      dismissedRef.current = null;
      const anchorRect = wrapperRect(
        wrapRef.current,
        displayRangeRect(host, selection.key, selection.map.display, run.start, run.end)
      );
      if (!anchorRect) {
        setTarget(null);
        return;
      }
      const next: LinkCardTarget = {
        href: run.href,
        key: selection.key,
        src: selection.src,
        dStart: run.start,
        dEnd: run.end,
        anchorRect
      };
      setTarget((current) => (sameTarget(current, next) ? current : next));
    },
    [hostRef, wrapRef]
  );

  // The page moved under a card that is already up (scroll, or a repaint that
  // reflowed the line). Re-measure the same run rather than dropping the card.
  const reposition = useCallback(
    (displayFor: (key: string) => string | null) => {
      const host = hostRef.current;
      if (!host) return;
      setTarget((current) => {
        if (!current) return current;
        const display = displayFor(current.key);
        if (display === null) return null;
        const anchorRect = wrapperRect(
          wrapRef.current,
          displayRangeRect(host, current.key, display, current.dStart, current.dEnd)
        );
        if (!anchorRect) return null;
        const next = { ...current, anchorRect };
        return sameTarget(current, next) ? current : next;
      });
    },
    [hostRef, wrapRef]
  );

  return { target, sync, hide, dismiss, reposition };
}
