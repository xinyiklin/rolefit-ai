import { useLayoutEffect, useRef } from "react";

function activeScrollOwner(
  elements: ReadonlyArray<HTMLDivElement | null>
): HTMLDivElement | null {
  const overflowOwner = elements.find((element) => {
    if (!element) return false;
    const overflowY = window.getComputedStyle(element).overflowY;
    return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
  });
  return overflowOwner ?? elements.find((element) => element !== null) ?? null;
}

/**
 * Keeps a document scroller's offset across the unmount a studio tab switch
 * causes, so returning to Resume or Cover letter shows the part of the page the
 * user was reading rather than the top.
 *
 * Three details make this less trivial than assigning `scrollTop`:
 *
 * 1. The offset cannot be applied on the first commit. The engine paints the
 *    document after layout, so the scroller has no scrollable height yet and the
 *    assignment silently clamps to 0. The layout effect below therefore runs on
 *    every render and retries until the content is tall enough, then stops.
 * 2. The desktop editor and narrow stacked layout are separate candidates; the
 *    element whose computed overflow owns scrolling is selected at each boundary.
 * 3. Both candidates are captured at mount and read in a LAYOUT cleanup. React
 *    runs that cleanup before detaching the nodes, so the value is still real; a
 *    passive cleanup can see a detached element, whose `scrollTop` reads 0. A
 *    scroll listener would be the obvious alternative and is deliberately not
 *    used — it adds a handler on a hot path to learn something the element
 *    already knows, and scroll events do not fire at all in the QA browser pane,
 *    which would make this unverifiable there.
 */
export function useRestoredScroll(initialTop: number, onExit: (top: number) => void) {
  const editorScrollerRef = useRef<HTMLDivElement>(null);
  const layoutScrollerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(initialTop);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useLayoutEffect(() => {
    const el = activeScrollOwner([
      layoutScrollerRef.current,
      editorScrollerRef.current
    ]);
    const target = pendingRef.current;
    if (!el || target <= 0) return;
    // Strictly: wait for the offset to be reachable rather than clamping to
    // whatever is painted so far, because the first commits are a document of
    // zero height and clamping there would land every return near the top. A
    // document that comes back SHORTER than the offset therefore never
    // restores — acceptable, because the only way it gets shorter is being
    // replaced, and the host clears the stored offset when it opens one.
    if (el.scrollHeight - el.clientHeight < target) return;
    el.scrollTop = target;
    pendingRef.current = 0;
  });

  useLayoutEffect(() => {
    const elements = [layoutScrollerRef.current, editorScrollerRef.current];
    return () => onExitRef.current(activeScrollOwner(elements)?.scrollTop ?? 0);
  }, []);

  return { editorScrollerRef, layoutScrollerRef };
}
